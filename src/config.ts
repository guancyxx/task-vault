// Plugin config = single source of truth for hook templates + time defaults (FR-022, contract §2).
// Persisted to `vault/.taskvault/config.json` (NOT plugin data.json) because the Python syncer
// reads the same file. Pure + obsidian-free so it unit-tests; the Setting UI lives in settings.ts.

import type { JsonStore } from './store/jsonStore';
import type { Lang } from './i18n';

// FR-034 phase two: one bearer token per agent identity; the API reverse-maps a token to its
// actor. A missing/empty token means that agent cannot authenticate.
export interface AgentTokens {
  hermes?: string;
  cc?: string;
  codex?: string;
}

export interface Config {
  version: number;
  terminal_hook: string; // '' = disabled
  dispatch_hook: string; // '' = disabled
  default_remind: { allday: string; timed: string };
  backstop_minutes: number;
  ui_language: Lang; // FR-039: 'auto' follows Obsidian's UI language
  api_enabled: boolean; // FR-034: built-in localhost HTTP API, off by default
  api_port: number; // 127.0.0.1:<port>
  agent_tokens: AgentTokens;
  projects_folder: string; // FR-041: where 新建项目 creates notes; '' = vault root
  dashboard_file: string; // FR-041: root nav note the command registers in; '' = skip registering
}

export const DEFAULT_API_PORT = 39187;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  terminal_hook: '',
  dispatch_hook: '',
  default_remind: { allday: '09:00', timed: 'due' },
  backstop_minutes: 30,
  ui_language: 'auto',
  api_enabled: false,
  api_port: DEFAULT_API_PORT,
  agent_tokens: {},
  projects_folder: '01 Projects',
  dashboard_file: 'Dashboard.md',
};

const UI_LANGUAGES: readonly Lang[] = ['auto', 'zh-CN', 'en'];

// Tolerate partial/legacy/corrupt JSON: every missing key falls back to the default (contract §2).
export function normalizeConfig(raw: unknown): Config {
  const r = (raw ?? {}) as Partial<Config>;
  const remind = (r.default_remind ?? {}) as Partial<Config['default_remind']>;
  const tokens = (r.agent_tokens ?? {}) as Partial<AgentTokens>;
  const token = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
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
    ui_language:
      typeof r.ui_language === 'string' && UI_LANGUAGES.includes(r.ui_language)
        ? r.ui_language
        : DEFAULT_CONFIG.ui_language,
    api_enabled: typeof r.api_enabled === 'boolean' ? r.api_enabled : DEFAULT_CONFIG.api_enabled,
    api_port:
      typeof r.api_port === 'number' && Number.isInteger(r.api_port) && r.api_port > 0 && r.api_port < 65536
        ? r.api_port
        : DEFAULT_CONFIG.api_port,
    agent_tokens: { hermes: token(tokens.hermes), cc: token(tokens.cc), codex: token(tokens.codex) },
    // FR-041: strip slashes so the paths join cleanly; '' stays '' (= vault root / skip).
    projects_folder: typeof r.projects_folder === 'string' ? r.projects_folder.replace(/^\/+|\/+$/g, '') : DEFAULT_CONFIG.projects_folder,
    dashboard_file: typeof r.dashboard_file === 'string' ? r.dashboard_file.replace(/^\/+|\/+$/g, '') : DEFAULT_CONFIG.dashboard_file,
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
