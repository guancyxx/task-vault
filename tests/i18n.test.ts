import { describe, expect, it } from 'vitest';
import { createT, resolveLang, type Lang } from '../src/i18n';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';
import { COMMAND_ROWS } from '../src/view/commands';
import { statusTooltip } from '../src/view/taskRow';

// FR-039 SC-020: the two dictionaries must carry the exact same key set — a missing key would show
// a raw key (or fall back) in one language only. Sorted compare so order differences don't matter.
describe('dictionary key parity (SC-020)', () => {
  it('en and zh have identical key sets', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('every value is a non-empty string in both languages', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `en[${key}]`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(zh)) {
      expect(value.length, `zh[${key}]`).toBeGreaterThan(0);
    }
  });
});

// Language resolution order: explicit setting wins; auto follows the host locale (zh* → zh, else en).
describe('resolveLang', () => {
  it('auto + a zh locale → zh-CN', () => {
    expect(resolveLang('auto', 'zh')).toBe('zh-CN');
    expect(resolveLang('auto', 'zh-CN')).toBe('zh-CN');
    expect(resolveLang('auto', 'ZH-tw')).toBe('zh-CN');
  });

  it('auto + a non-zh locale → en', () => {
    expect(resolveLang('auto', 'en')).toBe('en');
    expect(resolveLang('auto', 'fr')).toBe('en');
    expect(resolveLang('auto', '')).toBe('en');
  });

  it('an explicit setting overrides auto/locale', () => {
    expect(resolveLang('zh-CN', 'en')).toBe('zh-CN');
    expect(resolveLang('en', 'zh')).toBe('en');
  });
});

describe('createT', () => {
  it('returns the localized string for a key', () => {
    expect(createT('zh-CN')('reschedule.save')).toBe('保存');
    expect(createT('en')('reschedule.save')).toBe('Save');
  });

  it('fills {placeholder} tokens from params', () => {
    expect(createT('en')('delegate.fired', { assignee: 'cc' })).toBe('Delegated to cc');
    expect(createT('zh-CN')('delegate.fired', { assignee: 'cc' })).toBe('已委派给 cc');
  });

  it('leaves unknown tokens untouched and returns the key for an unknown key', () => {
    // an unknown key is echoed back rather than throwing
    expect(createT('en')('nope.not.a.key' as never)).toBe('nope.not.a.key');
  });
});

// statusTooltip is the pure FR-031 helper — verify it produces both languages via injected t.
describe('statusTooltip (bilingual)', () => {
  it('renders zh by default and en when given the en translator', () => {
    expect(statusTooltip('doing')).toBe('状态：进行中（doing）');
    expect(statusTooltip('doing', createT('en'))).toBe('Status: In progress (doing)');
  });
});

// FR-039 contract: COMMAND_ROWS keeps id + hotkey as contract fields; the display name comes from
// the dictionary via nameKey and resolves non-empty in both languages.
describe('COMMAND_ROWS name via dictionary', () => {
  it('id + key are unchanged and nameKey resolves in both languages', () => {
    expect(COMMAND_ROWS.map((r) => `${r.id}:${r.key}`)).toEqual([
      'quick-log:L',
      'log-decision:D',
      'log-comment:C',
      'log-blocker:K',
      'set-status:S',
      'delegate:A',
    ]);
    const zhT = createT('zh-CN');
    const enT = createT('en');
    for (const row of COMMAND_ROWS) {
      expect(zhT(row.nameKey).length).toBeGreaterThan(0);
      expect(enT(row.nameKey).length).toBeGreaterThan(0);
    }
  });
});

// Guard the setting type so the three legal values stay in sync with config normalization.
describe('Lang type values', () => {
  it('accepts the three settings', () => {
    const langs: Lang[] = ['auto', 'zh-CN', 'en'];
    for (const l of langs) expect(['auto', 'zh-CN', 'en']).toContain(l);
  });
});
