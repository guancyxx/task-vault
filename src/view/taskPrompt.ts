// Copy-able delegation prompt (user request 2026-08-19). Deliberately tiny: title, where the doc
// is, and the routine write-back. Everything else (需求/指令/历史/元信息) already lives in the
// document — restating it here only gave agents a second, staler source to reason about.
// Pure (no obsidian import) so it is unit-tested.

import type { Task } from '../model/types';

export interface PromptContext {
  task: Task;
  path: string; // vault-relative, e.g. `03 Tasks/magicedit/2026-08-19/foo.md`
  vaultName: string;
  basePath?: string; // absolute vault root; empty when the adapter is not a filesystem one
}

export function obsidianUri(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}

export function buildTaskPrompt(ctx: PromptContext): string {
  const abs = ctx.basePath ? `${ctx.basePath}/${ctx.path}` : ctx.path;
  return [
    `任务：${ctx.task.title}`,
    `文档：${abs}`,
    `Obsidian：${obsidianUri(ctx.vaultName, ctx.path)}`,
    '',
    '读这份文档执行：`## 任务描述` 是需求，`## 委派` 是指令，`## 执行记录` 是已发生的事。',
    '先给方案，等我确认再动手改东西——方案没过不要写代码。',
    '进展写进 `## 执行记录`（最新的写在最上面）：说清前因后果和中途的决策（为什么这么选、放弃了什么），以后复核只看这里。',
    'PR 合并、总结交完才算 done——在那之前别动 frontmatter 的 status。',
  ].join('\n');
}
