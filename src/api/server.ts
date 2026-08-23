// FR-034 phase two: the plugin's built-in localhost HTTP API. Zero-dependency node:http,
// desktop-only, off by default. Every write routes through the SAME seams the UI uses
// (createTaskFile / TaskActions), so the state machine, the FR-030 review gate, and hooks all
// stay in force — the API is just another caller, never a bypass.
//
// Hard boundaries: binds 127.0.0.1 ONLY (never 0.0.0.0); Bearer-token auth (one token per agent
// identity, reverse-mapped to an actor — the actor NEVER comes from the request body); no CORS;
// 64 KB body cap; errors are English JSON (`{ error }`) for machine consumers, not i18n.

import http from 'node:http';
import type { AgentTokens } from '../config';
import type { EntryKind } from '../log/executionLog';
import { LOG_HEADING } from '../log/executionLog';
import { TRANSITIONS } from '../model/statusMachine';
import type { Actor, Priority, Source, Status } from '../model/types';
import { STATUSES } from '../model/types';
import type { Entry } from '../store/taskStore';
import { getSection } from '../util/frontmatter';
import { parseCapture, type Capture } from '../view/captureParse';

const MAX_BODY = 64 * 1024; // 64 KB
const LOOPBACK = '127.0.0.1'; // written, never 0.0.0.0
const AGENT_ACTORS = ['hermes', 'cc', 'codex'] as const;
type AgentActor = (typeof AGENT_ACTORS)[number];
const VALID_KINDS: readonly string[] = ['决策', '评论', '卡点'];

// The three write seams the API reaches; TaskActions satisfies this structurally.
export interface ApiActions {
  setStatus(path: string, to: Status): Promise<void>;
  patch(path: string, patch: { due?: string; priority?: Priority }): Promise<void>;
  appendQuick(path: string, text: string, kind?: EntryKind): Promise<void>;
}

export interface ApiDeps {
  port: () => number;
  tokens: () => AgentTokens;
  store: { byId(id: string): Entry | undefined };
  createTask: (capture: Capture, now: Date, source: Source) => Promise<string>;
  actionsFor: (actor: Actor) => ApiActions;
  now: () => Date;
  onError: (err: Error) => void; // listen failure (e.g. EADDRINUSE) — surfaced, never thrown
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

class BodyTooLarge extends Error {}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (tooLarge) return; // keep draining so the 413 response still flushes
      size += c.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export class ApiServer {
  private server: http.Server | null = null;

  constructor(private deps: ApiDeps) {}

  start(): void {
    if (this.server) return; // idempotent: a second start never opens a second listener
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        try {
          sendJson(res, 500, { error: 'internal error' });
        } catch {
          // response already sent — nothing to do
        }
      });
    });
    server.on('error', (err) => {
      this.server = null;
      this.deps.onError(err);
    });
    server.listen(this.deps.port(), LOOPBACK);
    this.server = server;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const s = this.server;
      if (!s) return resolve();
      this.server = null;
      s.close(() => resolve());
      // Node 18+: drop lingering keep-alive sockets so close() actually resolves instead of
      // hanging on an idle agent connection — otherwise a restart races an unclosed listener.
      s.closeAllConnections?.();
    });
  }

  // Resolves to the bound port once listening (used by tests running on port 0).
  listening(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = this.server;
      if (!s) return reject(new Error('not started'));
      const port = (): number => {
        const a = s.address();
        return a && typeof a === 'object' ? a.port : 0;
      };
      if (s.listening) return resolve(port());
      s.once('listening', () => resolve(port()));
      s.once('error', reject);
    });
  }

  private actorForToken(authHeader?: string): AgentActor | null {
    if (!authHeader) return null;
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!m) return null;
    const token = m[1].trim();
    if (!token) return null;
    const t = this.deps.tokens();
    for (const actor of AGENT_ACTORS) {
      if (t[actor] && t[actor] === token) return actor;
    }
    return null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const actor = this.actorForToken(req.headers.authorization);
    if (!actor) return sendJson(res, 401, { error: 'unauthorized' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (parts.length === 1 && parts[0] === 'tasks' && method === 'POST') {
      return this.createTask(req, res, actor);
    }
    if (parts.length === 2 && parts[0] === 'tasks') {
      if (method === 'GET') return this.getTask(res, parts[1]);
      if (method === 'PATCH') return this.patchTask(req, res, actor, parts[1]);
    }
    if (parts.length === 3 && parts[0] === 'tasks' && parts[2] === 'log' && method === 'POST') {
      return this.logTask(req, res, actor, parts[1]);
    }
    return sendJson(res, 404, { error: 'not found' });
  }

  private async parseJsonBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<Record<string, unknown> | undefined> {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        sendJson(res, 413, { error: 'request body too large' });
        return undefined;
      }
      throw e; // socket error → outer handler answers 500
    }
    if (raw.trim() === '') return {};
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        sendJson(res, 400, { error: 'body must be a JSON object' });
        return undefined;
      }
      return v as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON' });
      return undefined;
    }
  }

  // POST /tasks { text } → parseCapture → createTaskFile (source = token's actor). 201 { path, title }.
  private async createTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    actor: AgentActor,
  ): Promise<void> {
    const body = await this.parseJsonBody(req, res);
    if (!body) return;
    const text = body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return sendJson(res, 400, { error: 'text required' });
    }
    const now = this.deps.now();
    const capture = parseCapture(text, now);
    if (!capture) return sendJson(res, 400, { error: 'empty title after parsing' });
    const path = await this.deps.createTask(capture, now, actor);
    return sendJson(res, 201, { path, title: capture.title });
  }

  // GET /tasks/:id → frontmatter summary + raw 执行记录 body.
  private getTask(res: http.ServerResponse, id: string): void {
    const entry = this.deps.store.byId(id);
    if (!entry) return sendJson(res, 404, { error: 'not found' });
    const log = getSection(entry.body, LOG_HEADING) ?? '';
    return sendJson(res, 200, { path: entry.path, task: entry.task, log });
  }

  // PATCH /tasks/:id { status?, due?, priority? }. status routes through setStatus so the FR-030
  // gate applies; illegal (or agent→done) transitions answer 409 with the legal target list.
  private async patchTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    actor: AgentActor,
    id: string,
  ): Promise<void> {
    const body = await this.parseJsonBody(req, res);
    if (!body) return;
    const entry = this.deps.store.byId(id);
    if (!entry) return sendJson(res, 404, { error: 'not found' });
    const actions = this.deps.actionsFor(actor);

    const status = body.status;
    if (status !== undefined) {
      if (typeof status !== 'string' || !STATUSES.includes(status as Status)) {
        return sendJson(res, 400, { error: 'invalid status' });
      }
      const from = entry.task.status;
      // Agents may never confirm done (FR-030 review gate) — filter it out of the legal set so the
      // rejection is expressed as "not a legal target", carrying the agent's real options.
      const legal = TRANSITIONS[from].filter((to) => to !== 'done' || !AGENT_ACTORS.includes(actor));
      if (!legal.includes(status as Status)) {
        return sendJson(res, 409, { error: `illegal transition ${from} -> ${status}`, legal });
      }
      await actions.setStatus(entry.path, status as Status);
    }

    const patch: { due?: string; priority?: Priority } = {};
    let hasPatch = false;
    const due = body.due;
    if (due !== undefined) {
      if (due !== null && typeof due !== 'string') return sendJson(res, 400, { error: 'invalid due' });
      patch.due = due === null ? undefined : due;
      hasPatch = true;
    }
    const priority = body.priority;
    if (priority !== undefined) {
      if (typeof priority !== 'string' || !['high', 'normal', 'low'].includes(priority)) {
        return sendJson(res, 400, { error: 'invalid priority' });
      }
      patch.priority = priority as Priority;
      hasPatch = true;
    }
    if (hasPatch) await actions.patch(entry.path, patch);
    return sendJson(res, 200, { ok: true });
  }

  // POST /tasks/:id/log { text, kind? } → appendQuick (progress / 决策 / 评论 / 卡点).
  private async logTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    actor: AgentActor,
    id: string,
  ): Promise<void> {
    const body = await this.parseJsonBody(req, res);
    if (!body) return;
    const entry = this.deps.store.byId(id);
    if (!entry) return sendJson(res, 404, { error: 'not found' });
    const text = body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return sendJson(res, 400, { error: 'text required' });
    }
    const kind = body.kind;
    if (kind !== undefined && (typeof kind !== 'string' || !VALID_KINDS.includes(kind))) {
      return sendJson(res, 400, { error: 'invalid kind' });
    }
    await this.deps.actionsFor(actor).appendQuick(entry.path, text, kind as EntryKind | undefined);
    return sendJson(res, 201, { ok: true });
  }
}
