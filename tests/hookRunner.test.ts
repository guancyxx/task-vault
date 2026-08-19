import { describe, expect, test } from 'vitest';
import type { Config } from '../src/config';
import { DEFAULT_CONFIG } from '../src/config';
import { EMPTY_LEDGER, HookRunner, normalizeLedger, type HookExec, type Ledger } from '../src/hooks/hookRunner';
import type { JsonStore } from '../src/store/jsonStore';
import type { Task } from '../src/model/types';

// ---- test doubles ----

function memLedger(init: Ledger = EMPTY_LEDGER): {
  store: JsonStore<Ledger>;
  current: () => Ledger;
  poke: (fn: (l: Ledger) => void) => void;
} {
  let cur: Ledger = JSON.parse(JSON.stringify(init));
  return {
    store: {
      read: async () => JSON.parse(JSON.stringify(cur)),
      write: async (v) => {
        cur = JSON.parse(JSON.stringify(v));
      },
    },
    current: () => cur,
    poke: (fn) => fn(cur),
  };
}

interface Call {
  cmd: string;
  env: Record<string, string>;
}
function recExec(): { exec: HookExec; calls: Call[]; onRun?: () => void } {
  const calls: Call[] = [];
  const box: { exec: HookExec; calls: Call[]; onRun?: () => void } = {
    calls,
    exec: {
      async run(cmd, env) {
        box.onRun?.();
        calls.push({ cmd, env });
      },
    },
  };
  return box;
}

const NOW = new Date(2026, 7, 19, 14, 32, 5); // 2026-08-19 14:32:05 local

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: '写周报',
    status: 'done',
    created: '2026-08-19T10:00',
    assignee: 'cc',
    ...over,
  };
}

function cfg(over: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...over };
}

function mkRunner(config: Config, ledger: JsonStore<Ledger>, exec: HookExec): HookRunner {
  return new HookRunner({ config: () => config, ledger, exec, now: () => NOW });
}

// ---- tests ----

describe('normalizeLedger', () => {
  test('garbage → empty ledger, never throws', () => {
    expect(normalizeLedger(null)).toEqual(EMPTY_LEDGER);
    expect(normalizeLedger({ terminal: 'x' })).toEqual(EMPTY_LEDGER);
  });
  test('keeps existing sections', () => {
    const l = normalizeLedger({ terminal: { a: { status: 'done', fired_at: 't' } } });
    expect(l.terminal.a).toEqual({ status: 'done', fired_at: 't' });
  });
});

describe('fireTerminal', () => {
  test('done fires with all placeholders + TV_* env, records ledger', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'run {TASK_ID} {TASK_STATUS} {TASK_TITLE} {TASK_ASSIGNEE} {TASK_PATH}' }), store, exec);

    const res = await r.fireTerminal(mkTask(), '03 Tasks/x.md');

    expect(res).toBe('fired');
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('run id-1 done 写周报 cc 03 Tasks/x.md');
    expect(calls[0].env).toMatchObject({
      TV_TASK_ID: 'id-1',
      TV_TASK_STATUS: 'done',
      TV_TASK_TITLE: '写周报',
      TV_TASK_ASSIGNEE: 'cc',
      TV_TASK_PATH: '03 Tasks/x.md',
    });
    expect(current().terminal['id-1']).toEqual({ status: 'done', fired_at: '2026-08-19T14:32:05+08:00' });
  });

  test('idempotent: same id already in ledger → skipped, no exec', async () => {
    const { store } = memLedger({
      ...EMPTY_LEDGER,
      terminal: { 'id-1': { status: 'done', fired_at: 'earlier' } },
    });
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'run' }), store, exec);

    const res = await r.fireTerminal(mkTask(), 'p.md');
    expect(res).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  test('cancelled fires once, second time skipped (per-id ledger)', async () => {
    const { store } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'run' }), store, exec);
    const t = mkTask({ status: 'cancelled' });

    expect(await r.fireTerminal(t, 'p.md')).toBe('fired');
    expect(await r.fireTerminal(t, 'p.md')).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  test('non-terminal status is a no-op (never fires terminal)', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'run' }), store, exec);

    const res = await r.fireTerminal(mkTask({ status: 'doing' }), 'p.md');
    expect(res).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(current().terminal).toEqual({});
  });

  test('empty template = disabled, no exec AND no ledger write', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: '' }), store, exec);

    const res = await r.fireTerminal(mkTask(), 'p.md');
    expect(res).toBe('disabled');
    expect(calls).toHaveLength(0);
    expect(current().terminal).toEqual({}); // no side effects
  });

  test('re-reads ledger before write (concurrent Python write survives)', async () => {
    const { store, current } = memLedger();
    const box = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'run' }), store, box.exec);
    // Simulate the syncer writing sync.last_run WHILE the hook command runs.
    box.onRun = () => {
      void store.write({ ...JSON.parse(JSON.stringify(current())), sync: { last_run: 'pythonstamp' } });
    };

    await r.fireTerminal(mkTask(), 'p.md');

    // our terminal entry AND the concurrent sync entry both present → we re-read, not clobbered.
    expect(current().terminal['id-1']).toBeDefined();
    expect(current().sync.last_run).toBe('pythonstamp');
  });
});

describe('fireDispatch', () => {
  test('runs dispatch_hook, injects instruction, increments count', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ dispatch_hook: 'go {TASK_ID} {TASK_INSTRUCTION}' }), store, exec);
    const t = mkTask({ status: 'todo' });

    expect(await r.fireDispatch(t, 'p.md', '修一下登录 bug')).toBe('fired');
    expect(calls[0].cmd).toBe('go id-1 修一下登录 bug');
    expect(calls[0].env.TV_TASK_INSTRUCTION).toBe('修一下登录 bug');
    expect(current().dispatch['id-1']).toEqual({ count: 1, last_at: '2026-08-19T14:32:05+08:00' });

    await r.fireDispatch(t, 'p.md', '再催一次');
    expect(current().dispatch['id-1'].count).toBe(2);
  });

  test('empty dispatch template = disabled', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ dispatch_hook: '' }), store, exec);
    expect(await r.fireDispatch(mkTask(), 'p.md', 'x')).toBe('disabled');
    expect(calls).toHaveLength(0);
    expect(current().dispatch).toEqual({});
  });
});

describe('fireManualSummary', () => {
  test('runs terminal_hook but never touches the ledger (not idempotent)', async () => {
    const { store, current } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: 'sum {TASK_STATUS}' }), store, exec);
    const t = mkTask({ status: 'doing' });

    expect(await r.fireManualSummary(t, 'p.md')).toBe('fired');
    expect(calls[0].cmd).toBe('sum doing');
    expect(current().terminal).toEqual({}); // no ledger entry
    // can fire again — no idempotency guard
    await r.fireManualSummary(t, 'p.md');
    expect(calls).toHaveLength(2);
  });

  test('empty template = disabled', async () => {
    const { store } = memLedger();
    const { exec, calls } = recExec();
    const r = mkRunner(cfg({ terminal_hook: '' }), store, exec);
    expect(await r.fireManualSummary(mkTask(), 'p.md')).toBe('disabled');
    expect(calls).toHaveLength(0);
  });
});
