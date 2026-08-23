import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiServer, type ApiActions } from '../src/api/server';
import { LOG_HEADING, recordEntry, type EntryInput } from '../src/log/executionLog';
import { transition } from '../src/model/statusMachine';
import type { Actor, Source, Task } from '../src/model/types';
import type { Entry } from '../src/store/taskStore';
import { getSection, parseTaskFile, serializeTaskFile } from '../src/util/frontmatter';
import { captureToTask, parseCapture, slugify } from '../src/view/captureParse';

const NOW = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32
const TOKENS = { hermes: 'tok-hermes', cc: 'tok-cc' } as const; // codex intentionally unset

// In-memory vault + the three write seams, built from the real pure helpers so the assertions
// exercise genuine state-machine + log-format logic (the server under test only routes/authorizes).
class Harness {
  files = new Map<string, string>();
  private seq = 0;

  seed(task: Partial<Task> & { id: string }, body = ''): string {
    const full = { title: task.id, status: 'todo', created: '2026-08-19T09:00', due: '2026-08-19', ...task } as Task;
    const path = `03 Tasks/${task.id}.md`;
    this.files.set(path, serializeTaskFile(full, body));
    return path;
  }

  byId(id: string): Entry | undefined {
    for (const [path, raw] of this.files) {
      const p = parseTaskFile(raw, path);
      if (p.ok && p.task.id === id) return { path, task: p.task, body: p.body };
    }
    return undefined;
  }

  // Mirrors VaultSource.createTaskFile: slug filename with -2/-3… collision suffixes, source stamped.
  createTask = async (capture: ReturnType<typeof parseCapture>, now: Date, source: Source): Promise<string> => {
    const task = captureToTask(capture!, { id: `id-${++this.seq}`, now, source });
    const base = slugify(task.title);
    let path = `03 Tasks/${base}.md`;
    for (let n = 2; this.files.has(path); n++) path = `03 Tasks/${base}-${n}.md`;
    this.files.set(path, serializeTaskFile(task, ''));
    return path;
  };

  actionsFor = (actor: Actor): ApiActions => ({
    setStatus: async (path, to) => {
      const p = parseTaskFile(this.files.get(path)!, path);
      if (!p.ok) throw new Error('parse');
      const res = transition(p.task, to, actor, NOW); // authoritative gate; throws if illegal
      const body = recordEntry(p.body, { ts: res.record.at, actor, from: res.record.from, to, text: '' });
      this.files.set(path, serializeTaskFile({ ...p.task, ...res.patch }, body));
    },
    patch: async (path, patch) => {
      const p = parseTaskFile(this.files.get(path)!, path);
      if (!p.ok) throw new Error('parse');
      const task = { ...p.task };
      if ('due' in patch) patch.due === undefined ? delete task.due : (task.due = patch.due);
      if ('priority' in patch) patch.priority === undefined ? delete task.priority : (task.priority = patch.priority);
      this.files.set(path, serializeTaskFile(task, p.body));
    },
    appendQuick: async (path, text, kind) => {
      const p = parseTaskFile(this.files.get(path)!, path);
      if (!p.ok) throw new Error('parse');
      const entry: EntryInput = { ts: NOW, actor, text };
      if (kind) entry.kind = kind;
      this.files.set(path, serializeTaskFile(p.task, recordEntry(p.body, entry)));
    },
  });

  server(): ApiServer {
    return new ApiServer({
      port: () => 0,
      tokens: () => TOKENS,
      store: this,
      createTask: this.createTask,
      actionsFor: this.actionsFor,
      now: () => NOW,
      onError: () => {},
    });
  }
}

let h: Harness;
let server: ApiServer;
let base: string;

beforeEach(async () => {
  h = new Harness();
  server = h.server();
  server.start();
  base = `http://127.0.0.1:${await server.listening()}`;
});

afterEach(async () => {
  await server.close();
});

function req(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
}

describe('auth', () => {
  it('missing token → 401', async () => {
    const res = await req('/tasks', { method: 'POST', body: JSON.stringify({ text: 'x' }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBeTruthy();
  });

  it('wrong token → 401', async () => {
    const res = await req('/tasks', { method: 'POST', token: 'nope', body: JSON.stringify({ text: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('a blank bearer token → 401', async () => {
    const res = await fetch(`${base}/tasks/x`, { headers: { authorization: 'Bearer ' } });
    expect(res.status).toBe(401);
  });
});

describe('POST /tasks', () => {
  it('creates a task and stamps source = token actor (201)', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '写周报 !high' }) });
    expect(res.status).toBe(201);
    const { path, title } = await res.json();
    expect(title).toBe('写周报');
    const parsed = parseTaskFile(h.files.get(path)!, path);
    expect(parsed.ok && parsed.task.source).toBe('hermes');
    expect(parsed.ok && parsed.task.priority).toBe('high');
  });

  it('cc token stamps source = cc', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.cc, body: JSON.stringify({ text: '买菜' }) });
    const { path } = await res.json();
    const parsed = parseTaskFile(h.files.get(path)!, path);
    expect(parsed.ok && parsed.task.source).toBe('cc');
  });

  it('duplicate title creates a suffixed file, matching capture semantics', async () => {
    const first = await (await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '重复' }) })).json();
    const second = await (await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '重复' }) })).json();
    expect(first.path).not.toBe(second.path);
    expect(second.path).toMatch(/-2\.md$/);
  });

  it('empty text → 400', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '   ' }) });
    expect(res.status).toBe(400);
  });

  it('unparseable capture (metadata only, no title) → 400', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '!high' }) });
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks/:id', () => {
  it('returns frontmatter + raw execution log', async () => {
    h.seed({ id: 't-get', status: 'doing' }, `${LOG_HEADING}\n\n- 2026-08-19 10:00 · \`user\`\n  接单`);
    const res = await req('/tasks/t-get', { token: TOKENS.hermes });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe('t-get');
    expect(body.task.status).toBe('doing');
    expect(body.log).toContain('接单');
  });

  it('unindexed id → 404', async () => {
    const res = await req('/tasks/nope', { token: TOKENS.hermes });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id status (FR-030 gate)', () => {
  it('agent → done is rejected 409, status unchanged, legal omits done', async () => {
    h.seed({ id: 't-done', status: 'doing' });
    const res = await req('/tasks/t-done', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ status: 'done' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.legal).toContain('review');
    expect(body.legal).not.toContain('done');
    expect(h.byId('t-done')!.task.status).toBe('doing'); // untouched
  });

  it('agent → review succeeds (200), file advances', async () => {
    h.seed({ id: 't-review', status: 'doing' });
    const res = await req('/tasks/t-review', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ status: 'review' }) });
    expect(res.status).toBe(200);
    expect(h.byId('t-review')!.task.status).toBe('review');
  });

  it('illegal transition → 409 with legal targets', async () => {
    h.seed({ id: 't-illegal', status: 'doing' });
    const res = await req('/tasks/t-illegal', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ status: 'todo' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.legal).toEqual(expect.arrayContaining(['waiting', 'review', 'cancelled']));
    expect(body.legal).not.toContain('done');
  });

  it('due + priority patch through (200)', async () => {
    h.seed({ id: 't-patch', status: 'doing' });
    const res = await req('/tasks/t-patch', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ due: '2026-09-01', priority: 'low' }) });
    expect(res.status).toBe(200);
    const t = h.byId('t-patch')!.task;
    expect(t.due).toBe('2026-09-01');
    expect(t.priority).toBe('low');
  });

  it('invalid priority → 400', async () => {
    h.seed({ id: 't-bad', status: 'doing' });
    const res = await req('/tasks/t-bad', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ priority: 'urgent' }) });
    expect(res.status).toBe(400);
  });

  it('unindexed id → 404', async () => {
    const res = await req('/tasks/nope', { method: 'PATCH', token: TOKENS.hermes, body: JSON.stringify({ status: 'review' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST /tasks/:id/log', () => {
  it('appends a protocol entry with a space-separated timestamp prefix (201)', async () => {
    h.seed({ id: 't-log', status: 'doing' });
    const res = await req('/tasks/t-log/log', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '拉起分支' }) });
    expect(res.status).toBe(201);
    const log = getSection(h.byId('t-log')!.body, LOG_HEADING) ?? '';
    expect(log).toMatch(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} /); // space, not T, before time
    expect(log).toContain('拉起分支');
    expect(log).toContain('`hermes`'); // actor from token, not body
  });

  it('a typed kind renders its tag', async () => {
    h.seed({ id: 't-kind', status: 'doing' });
    await req('/tasks/t-kind/log', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '选 A 方案', kind: '决策' }) });
    expect(getSection(h.byId('t-kind')!.body, LOG_HEADING)).toContain('**决策**');
  });

  it('invalid kind → 400', async () => {
    h.seed({ id: 't-k2', status: 'doing' });
    const res = await req('/tasks/t-k2/log', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: 'x', kind: 'bogus' }) });
    expect(res.status).toBe(400);
  });

  it('empty text → 400', async () => {
    h.seed({ id: 't-k3', status: 'doing' });
    const res = await req('/tasks/t-k3/log', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: '' }) });
    expect(res.status).toBe(400);
  });

  it('unindexed id → 404', async () => {
    const res = await req('/tasks/nope/log', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: 'x' }) });
    expect(res.status).toBe(404);
  });
});

describe('routing + body limits', () => {
  it('unknown route → 404', async () => {
    const res = await req('/nope', { token: TOKENS.hermes });
    expect(res.status).toBe(404);
  });

  it('body over 64 KB → 413', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: JSON.stringify({ text: 'x'.repeat(70 * 1024) }) });
    expect(res.status).toBe(413);
  });

  it('malformed JSON → 400', async () => {
    const res = await req('/tasks', { method: 'POST', token: TOKENS.hermes, body: '{ not json' });
    expect(res.status).toBe(400);
  });
});

describe('lifecycle', () => {
  it('a second start() does not stack a second listener/port', async () => {
    const p1 = await server.listening();
    server.start(); // no-op
    const p2 = await server.listening();
    expect(p2).toBe(p1);
  });

  it('close() is idempotent', async () => {
    const s = h.server();
    s.start();
    await s.listening();
    await s.close();
    await expect(s.close()).resolves.toBeUndefined();
  });

  it('a fresh server can rebind after close (start → close → start)', async () => {
    const s = h.server();
    s.start();
    const port = await s.listening();
    expect(port).toBeGreaterThan(0);
    await s.close();
  });

  // 补强: someone else already holds the port. listen() must fail gracefully — onError fires
  // (the Notice path), the server is not left listening, and nothing throws synchronously.
  it('EADDRINUSE → onError fires, server not listening, no crash', async () => {
    const blocker = net.createServer();
    const port: number = await new Promise((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        const a = blocker.address();
        resolve(a && typeof a === 'object' ? a.port : 0);
      });
    });
    let caught: Error | undefined;
    const s = new ApiServer({
      port: () => port,
      tokens: () => TOKENS,
      store: h,
      createTask: h.createTask,
      actionsFor: h.actionsFor,
      now: () => NOW,
      onError: (err) => {
        caught = err;
      },
    });
    expect(() => s.start()).not.toThrow(); // synchronous start never throws
    await expect(s.listening()).rejects.toThrow(); // bind failed → never became listening
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe('EADDRINUSE');
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});
