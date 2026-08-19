// Hook체계 (FR-019/020/021, contract §2/§3). Fires configurable shell commands on terminal
// transitions and delegations, guarded by an idempotent ledger.
//
// Purity: the runner takes an injected HookExec (child_process) + a JsonStore<Ledger> so the
// idempotency/param logic is unit-tested with fakes. NodeHookExec is the thin real adapter.
//
// Ledger idempotency is PER-ID for terminal (contract §3: `terminal.<id>` exists → never re-fire),
// so once a task has fired done OR cancelled it never fires terminal again. Every mutation
// RE-READS the ledger right before writing (the Python syncer may write the same file concurrently).

import { exec as nodeExec } from 'node:child_process';
import type { Config } from '../config';
import { TERMINAL_STATUSES, type Task } from '../model/types';
import type { JsonStore } from '../store/jsonStore';

export interface Ledger {
  version: number;
  terminal: Record<string, { status: string; fired_at: string }>;
  dispatch: Record<string, { count: number; last_at: string }>;
  sync: { last_run?: string };
}

export const EMPTY_LEDGER: Ledger = { version: 1, terminal: {}, dispatch: {}, sync: {} };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Tolerate partial/corrupt JSON so a bad section never sinks the whole ledger (contract §3).
export function normalizeLedger(raw: unknown): Ledger {
  const r = isObj(raw) ? raw : {};
  return {
    version: typeof r.version === 'number' ? r.version : 1,
    terminal: (isObj(r.terminal) ? r.terminal : {}) as Ledger['terminal'],
    dispatch: (isObj(r.dispatch) ? r.dispatch : {}) as Ledger['dispatch'],
    sync: (isObj(r.sync) ? r.sync : {}) as Ledger['sync'],
  };
}

export interface HookExec {
  run(cmd: string, env: Record<string, string>): Promise<void>;
}

export interface HookRunnerDeps {
  config: () => Config;
  ledger: JsonStore<Ledger>;
  exec: HookExec;
  now: () => Date;
}

export type FireResult = 'fired' | 'skipped' | 'disabled';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ponytail: hardcoded +08:00 — single-user Asia/Shanghai machine (see AGENTS 铁律 4). If the host
// TZ ever moves, swap for a real offset computed from the Date.
function stampCST(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}+08:00`;
}

function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function vars(task: Task, path: string, instruction: string): Record<string, string> {
  return {
    TASK_PATH: path,
    TASK_ID: task.id,
    TASK_STATUS: task.status,
    TASK_TITLE: task.title,
    TASK_ASSIGNEE: task.assignee ?? '',
    TASK_INSTRUCTION: instruction,
  };
}

function subst(template: string, v: Record<string, string>): string {
  let out = template;
  for (const [k, val] of Object.entries(v)) out = out.split(`{${k}}`).join(val);
  return out;
}

function envFor(v: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) env[`TV_${k}`] = val;
  return env;
}

export class HookRunner {
  constructor(private deps: HookRunnerDeps) {}

  // FR-019: done/cancelled → fire terminal hook once (idempotent). Empty template = no side effects.
  async fireTerminal(task: Task, path: string): Promise<FireResult> {
    if (!isTerminal(task.status)) return 'skipped';
    const template = this.deps.config().terminal_hook;
    if (template === '') return 'disabled';

    const before = await this.deps.ledger.read();
    if (before.terminal[task.id]) return 'skipped';

    await this.run(template, task, path, '');

    const l = normalizeLedger(await this.deps.ledger.read()); // re-read: syncer may have written
    l.terminal[task.id] = { status: task.status, fired_at: stampCST(this.deps.now()) };
    await this.deps.ledger.write(l);
    return 'fired';
  }

  // FR-021: delegation → fire dispatch hook + bump the count/last_at (drives the backstop cron).
  async fireDispatch(task: Task, path: string, instruction: string): Promise<FireResult> {
    const template = this.deps.config().dispatch_hook;
    if (template === '') return 'disabled';

    await this.run(template, task, path, instruction);

    const l = normalizeLedger(await this.deps.ledger.read());
    const prev = l.dispatch[task.id]?.count ?? 0;
    l.dispatch[task.id] = { count: prev + 1, last_at: stampCST(this.deps.now()) };
    await this.deps.ledger.write(l);
    return 'fired';
  }

  // FR-020: manual "总结" — fires the terminal hook on demand, in ANY state, WITHOUT the ledger
  // (never consumes the idempotency slot).
  async fireManualSummary(task: Task, path: string): Promise<FireResult> {
    const template = this.deps.config().terminal_hook;
    if (template === '') return 'disabled';
    await this.run(template, task, path, '');
    return 'fired';
  }

  private async run(template: string, task: Task, path: string, instruction: string): Promise<void> {
    const v = vars(task, path, instruction);
    await this.deps.exec.run(subst(template, v), envFor(v));
  }
}

// Real adapter: run the command through the shell with TV_* merged into the environment.
export class NodeHookExec implements HookExec {
  run(cmd: string, env: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      nodeExec(cmd, { env: { ...process.env, ...env } }, (err) => (err ? reject(err) : resolve()));
    });
  }
}
