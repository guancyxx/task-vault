import { describe, expect, it } from 'vitest';
import { formatEntry, LOG_HEADING, recordEntry } from '../src/log/executionLog';
import { getSection } from '../src/util/frontmatter';

const TS = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32

describe('formatEntry (FR-018, contract §7)', () => {
  it('formats a status-migration record `[from→to]`', () => {
    expect(formatEntry({ ts: TS, actor: 'hermes', from: 'todo', to: 'doing', text: '开始处理' })).toBe(
      '- 2026-08-19 14:32 · **todo→doing** · `hermes`\n  开始处理',
    );
  });

  it('formats a typed entry `[决策|评论|卡点]`', () => {
    expect(formatEntry({ ts: TS, actor: 'cc', kind: '决策', text: '选用方案 A' })).toBe(
      '- 2026-08-19 14:32 · **决策** · `cc`\n  选用方案 A',
    );
    expect(formatEntry({ ts: TS, actor: 'user', kind: '评论', text: '还行' })).toBe(
      '- 2026-08-19 14:32 · **评论** · `user`\n  还行',
    );
    expect(formatEntry({ ts: TS, actor: 'codex', kind: '卡点', text: '缺依赖' })).toBe(
      '- 2026-08-19 14:32 · **卡点** · `codex`\n  缺依赖',
    );
  });

  it('formats a plain progress entry (no tag)', () => {
    expect(formatEntry({ ts: TS, actor: 'hermes', text: '推进一半' })).toBe(
      '- 2026-08-19 14:32 · `hermes`\n  推进一半',
    );
  });

  it('pads single-digit month/day/hour/minute', () => {
    expect(formatEntry({ ts: new Date(2026, 0, 3, 9, 5), actor: 'user', text: 'x' })).toBe(
      '- 2026-01-03 09:05 · `user`\n  x',
    );
  });

  it('indents every line of a multi-line entry so it stays one list item', () => {
    expect(formatEntry({ ts: TS, actor: 'cc', text: '第一行\n第二行' })).toBe(
      '- 2026-08-19 14:32 · `cc`\n  第一行\n  第二行',
    );
  });

  it('prefers migration tag over kind when both present', () => {
    expect(formatEntry({ ts: TS, actor: 'cc', kind: '决策', from: 'doing', to: 'done', text: 'ok' })).toBe(
      '- 2026-08-19 14:32 · **doing→done** · `cc`\n  ok',
    );
  });
});

describe('recordEntry section handling', () => {
  it('creates the section (with heading) when absent', () => {
    const out = recordEntry('', { ts: TS, actor: 'hermes', text: '首条' });
    expect(out).toContain(LOG_HEADING);
    expect(getSection(out, LOG_HEADING)).toBe('- 2026-08-19 14:32 · `hermes`\n  首条');
  });

  it('creates the section after existing body without clobbering it', () => {
    const body = '一些正文说明\n';
    const out = recordEntry(body, { ts: TS, actor: 'cc', text: 'a' });
    expect(out.startsWith('一些正文说明\n')).toBe(true);
    expect(out).toContain('## 执行记录\n- 2026-08-19 14:32 · `cc`\n  a');
  });

  it('puts the newest entry on top, preserving prior ones below', () => {
    const body = '## 执行记录\n- 2026-08-19 09:00 · `user`\n  老记录\n';
    const out = recordEntry(body, { ts: TS, actor: 'hermes', from: 'todo', to: 'doing', text: '继续' });
    expect(getSection(out, LOG_HEADING)).toBe(
      '- 2026-08-19 14:32 · **todo→doing** · `hermes`\n  继续\n\n- 2026-08-19 09:00 · `user`\n  老记录',
    );
  });

  it('never touches other sections (逐字节 for 委派)', () => {
    const body = '## 执行记录\n- 2026-08-19 09:00 [user] 老记录\n\n## 委派\n- @cc 请处理\n';
    const out = recordEntry(body, { ts: TS, actor: 'cc', kind: '评论', text: 'ok' });
    expect(getSection(out, '## 委派')).toBe('- @cc 请处理');
    expect(out.includes('## 委派\n- @cc 请处理')).toBe(true);
  });
});
