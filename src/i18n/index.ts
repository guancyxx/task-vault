// i18n core (FR-039): language resolution + a `t(key, params)` function factory. Zero deps
// (no i18next) and obsidian-free so it unit-tests. Views/commands receive a `t` by construction
// (never a global singleton) so tests can hold two languages at once.

import { en } from './en';
import { zh } from './zh';

// User setting: 'auto' follows Obsidian's UI language; the other two force a language.
export type Lang = 'auto' | 'zh-CN' | 'en';
// A concrete dictionary language (what 'auto' resolves to).
export type ResolvedLang = 'zh-CN' | 'en';

export type MessageKey = keyof typeof en;
export type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const DICTS: Record<ResolvedLang, Record<MessageKey, string>> = {
  'zh-CN': zh,
  en,
};

// Explicit setting wins; on 'auto', a locale starting with 'zh' → Chinese, anything else → en
// (unknown locales fall back to en). `obsidianLocale` is whatever the host reports (e.g. 'zh',
// 'zh-CN', 'en', 'fr', or '').
export function resolveLang(setting: Lang, obsidianLocale: string): ResolvedLang {
  if (setting === 'zh-CN' || setting === 'en') return setting;
  return obsidianLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

// Build a bound translator. `{name}` tokens in the string are replaced from params; an unknown
// key returns the key itself (loud but non-throwing — a missing string never breaks the UI).
export function createT(lang: ResolvedLang): T {
  const dict = DICTS[lang];
  return (key, params) => {
    const template = dict[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  };
}
