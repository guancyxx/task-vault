import { describe, expect, it } from 'vitest';
import type { Task } from '../src/model/types';
import { buildTaskPrompt, obsidianUri } from '../src/view/taskPrompt';

const TASK: Task = {
  id: 'abc-123',
  title: '修好委派',
  status: 'doing',
  created: '2026-08-19T09:00',
  due: '2026-08-25',
  project: 'magicedit',
  priority: 'high',
};

const CTX = {
  task: TASK,
  path: '03 Tasks/magicedit/2026-08-19/fix.md',
  vaultName: 'Obsidian Vault',
  basePath: '/Users/me/Documents/Obsidian Vault',
};

describe('buildTaskPrompt', () => {
  it('gives the title, the absolute path and the obsidian:// link', () => {
    const out = buildTaskPrompt(CTX);
    expect(out).toContain('任务：修好委派');
    expect(out).toContain('文档：/Users/me/Documents/Obsidian Vault/03 Tasks/magicedit/2026-08-19/fix.md');
    expect(out).toContain('obsidian://open?vault=Obsidian%20Vault&file=03%20Tasks');
  });

  it('falls back to the vault-relative path when no base path is available', () => {
    expect(buildTaskPrompt({ ...CTX, basePath: '' })).toContain('文档：03 Tasks/magicedit/2026-08-19/fix.md');
  });

  // 用户 2026-08-19：元信息/状态机契约让 CC 绕远路。它们都在文档里，提示词不再复述。
  it('stays short — no metadata dump, no status-machine lecture', () => {
    const out = buildTaskPrompt(CTX);
    expect(out.split('\n').length).toBeLessThanOrEqual(8);
    expect(out).not.toContain('优先级');
    expect(out).not.toContain('合法去向');
    expect(out).not.toContain('元信息');
  });

  // 用户 2026-08-19：粘给 agent 的这份必须先停在方案上，不许直接开改。
  it('demands a plan before any edit', () => {
    expect(buildTaskPrompt(CTX)).toContain('先给方案，等我确认再动手');
  });

  // 用户 2026-08-19：done 的判据是 PR 合并 + 总结交付，不是「代码写完了」；
  // 执行记录要留下前因后果，否则事后复核无从查起。
  it('defines done as merged-and-summarized, and asks the log to carry the reasoning', () => {
    const out = buildTaskPrompt(CTX);
    expect(out).toContain('PR 合并、总结交完才算 done');
    expect(out).toContain('前因后果');
    expect(out).toContain('最新的写在最上面'); // 手写条目掉到底部就把倒序弄花了
  });
});

describe('obsidianUri', () => {
  it('encodes the vault name and path', () => {
    expect(obsidianUri('My Vault', 'a b/c.md')).toBe('obsidian://open?vault=My%20Vault&file=a%20b%2Fc.md');
  });
});
