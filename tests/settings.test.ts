import { describe, expect, test } from 'vitest';
import { ConfigService, DEFAULT_CONFIG, normalizeConfig, type Config } from '../src/config';
import type { JsonStore } from '../src/store/jsonStore';

function memStore<T>(init: T): { store: JsonStore<T>; current: () => T } {
  let cur: T = JSON.parse(JSON.stringify(init));
  return {
    store: {
      read: async () => JSON.parse(JSON.stringify(cur)),
      write: async (v) => {
        cur = JSON.parse(JSON.stringify(v));
      },
    },
    current: () => cur,
  };
}

describe('normalizeConfig', () => {
  test('empty object → full defaults', () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  test('null/garbage → defaults, never throws', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(42)).toEqual(DEFAULT_CONFIG);
  });

  test('partial file keeps given keys, fills the rest', () => {
    const cfg = normalizeConfig({ terminal_hook: 'echo hi', backstop_minutes: 15 });
    expect(cfg.terminal_hook).toBe('echo hi');
    expect(cfg.backstop_minutes).toBe(15);
    expect(cfg.dispatch_hook).toBe('');
    expect(cfg.default_remind).toEqual({ allday: '09:00', timed: 'due' });
  });

  test('nested default_remind is merged key-by-key', () => {
    const cfg = normalizeConfig({ default_remind: { allday: '08:30' } } as Partial<Config>);
    expect(cfg.default_remind).toEqual({ allday: '08:30', timed: 'due' });
  });
});

describe('ConfigService', () => {
  test('load reads through the store; get returns cached', async () => {
    const { store } = memStore<Config>({ ...DEFAULT_CONFIG, terminal_hook: 'x' });
    const svc = new ConfigService(store);
    await svc.load();
    expect(svc.get().terminal_hook).toBe('x');
  });

  test('update merges, normalizes and persists', async () => {
    const { store, current } = memStore<Config>(DEFAULT_CONFIG);
    const svc = new ConfigService(store);
    await svc.load();
    await svc.update({ terminal_hook: 'run.sh' });
    expect(svc.get().terminal_hook).toBe('run.sh');
    expect(current().terminal_hook).toBe('run.sh');
    // untouched keys survive the merge
    expect(current().backstop_minutes).toBe(30);
  });
});
