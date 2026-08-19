// Plugin config = single source of truth for hook templates + time defaults (FR-022, contract §2).
// Persisted to `vault/.taskvault/config.json` (NOT plugin data.json) because the Python syncer
// reads the same file. Pure + obsidian-free so it unit-tests; the Setting UI lives in settings.ts.

import type { JsonStore } from './store/jsonStore';

export interface Config {
  version: number;
  terminal_hook: string; // '' = disabled
  dispatch_hook: string; // '' = disabled
  default_remind: { allday: string; timed: string };
  backstop_minutes: number;
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  terminal_hook: '',
  dispatch_hook: '',
  default_remind: { allday: '09:00', timed: 'due' },
  backstop_minutes: 30,
};

// Tolerate partial/legacy/corrupt JSON: every missing key falls back to the default (contract §2).
export function normalizeConfig(raw: unknown): Config {
  const r = (raw ?? {}) as Partial<Config>;
  const remind = (r.default_remind ?? {}) as Partial<Config['default_remind']>;
  return {
    version: typeof r.version === 'number' ? r.version : DEFAULT_CONFIG.version,
    terminal_hook: typeof r.terminal_hook === 'string' ? r.terminal_hook : DEFAULT_CONFIG.terminal_hook,
    dispatch_hook: typeof r.dispatch_hook === 'string' ? r.dispatch_hook : DEFAULT_CONFIG.dispatch_hook,
    default_remind: {
      allday: typeof remind.allday === 'string' ? remind.allday : DEFAULT_CONFIG.default_remind.allday,
      timed: typeof remind.timed === 'string' ? remind.timed : DEFAULT_CONFIG.default_remind.timed,
    },
    backstop_minutes:
      typeof r.backstop_minutes === 'number' ? r.backstop_minutes : DEFAULT_CONFIG.backstop_minutes,
  };
}

// In-memory cache over the JSON store. Loaded once on plugin load; every UI edit writes through.
export class ConfigService {
  private cfg: Config = DEFAULT_CONFIG;

  constructor(private store: JsonStore<Config>) {}

  async load(): Promise<void> {
    this.cfg = await this.store.read();
  }

  get(): Config {
    return this.cfg;
  }

  async update(patch: Partial<Config>): Promise<void> {
    this.cfg = normalizeConfig({ ...this.cfg, ...patch });
    await this.store.write(this.cfg);
  }
}
