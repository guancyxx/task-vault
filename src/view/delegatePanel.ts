// Shared delegation UI (FR-015): agent select + instruction textarea + 委派 button, plus the
// FireResult → Notice mapping. Extracted so the detail popover (DetailModal) and the standalone
// 委派 command (H3 / FR-032) render ONE implementation instead of a copy-paste pair. A delegation
// whose dispatch hook is disabled or errored must SAY so, not silently claim success — that is the
// FR-021 regression these two notices guard.

import { Notice } from 'obsidian';
import type { FireResult } from '../hooks/hookRunner';

// Recommended delegation order (FR-015): CC > Codex > Hermes.
export const AGENTS: Array<{ value: string; label: string }> = [
  { value: 'cc', label: 'CC' },
  { value: 'codex', label: 'Codex' },
  { value: 'hermes', label: 'Hermes' },
];

export interface DelegatePanelOpts {
  assignee?: string; // preselect the current assignee, if any
  instruction: string; // initial textarea value (survives popover re-renders)
  onInstructionChange?(value: string): void;
  // Caller owns the write: it wires actions.delegate + result notices + close/re-render.
  // btn is handed back so the caller can disable it while the hook fires.
  onSubmit(assignee: string, instruction: string, btn: HTMLButtonElement): void;
}

export function renderDelegatePanel(body: HTMLElement, opts: DelegatePanelOpts): void {
  const wrap = body.createDiv({ cls: 'tv-detail-delegate' });
  const select = wrap.createEl('select');
  for (const a of AGENTS) select.createEl('option', { text: a.label, attr: { value: a.value } });
  if (opts.assignee) select.value = opts.assignee;
  const instruction = wrap.createEl('textarea', { attr: { placeholder: '给 agent 的指令（全文写入「## 委派」）' } });
  instruction.value = opts.instruction;
  instruction.addEventListener('input', () => opts.onInstructionChange?.(instruction.value));
  const btn = wrap.createEl('button', { cls: 'tv-btn tv-btn-cta', text: '委派' });
  btn.addEventListener('click', () => {
    const text = instruction.value.trim();
    if (!text) {
      new Notice('请填写委派指令');
      return;
    }
    opts.onSubmit(select.value, text, btn);
  });
}

// FireResult → user-facing notice. 只有真 fire 了 hook 才叫「已委派」——hook 空或炸了必须说出来，
// 否则 frontmatter 写了、agent 没起，用户以为交出去了（FR-021 回归）。
export function notifyDelegateResult(res: FireResult | 'error', assignee: string): void {
  if (res === 'fired') new Notice(`已委派给 ${assignee}`);
  else if (res === 'disabled')
    new Notice(`⚠️ 已写入 ${assignee}，但派发 hook 未配置——没有 agent 被启动（设置 → Task Vault → 派发 hook）`, 10000);
  else new Notice(`⚠️ 已写入 ${assignee}，但派发失败——没有 agent 被启动`, 10000);
}
