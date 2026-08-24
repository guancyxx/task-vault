// Shared delegation UI (FR-015): agent select + instruction textarea + 委派 button, plus the
// FireResult → Notice mapping. Extracted so the detail popover (DetailModal) and the standalone
// 委派 command (H3 / FR-032) render ONE implementation instead of a copy-paste pair. A delegation
// whose dispatch hook is disabled or errored must SAY so, not silently claim success — that is the
// FR-021 regression these two notices guard.

import { Notice } from 'obsidian';
import type { FireResult } from '../hooks/hookRunner';
import type { T } from '../i18n';

// Recommended delegation order (FR-015): CC > Codex > Hermes.
export const AGENTS: Array<{ value: string; label: string }> = [
  { value: 'cc', label: 'CC' },
  { value: 'codex', label: 'Codex' },
  { value: 'hermes', label: 'Hermes' },
];

export interface DelegatePanelOpts {
  assignee?: string; // preselect the current assignee, if any
  instruction: string; // initial textarea value (survives popover re-renders)
  // FR-048: task already dispatched (frontmatter `dispatched` set) → the task has an ongoing
  // agent engagement: show the 续接会话 badge and default the textarea to the follow-up seed
  // instead of a fresh instruction. The panel itself stays read-only on task fields.
  dispatched?: boolean;
  onInstructionChange?(value: string): void;
  // Caller owns the write: it wires actions.delegate + result notices + close/re-render.
  // btn is handed back so the caller can disable it while the hook fires.
  onSubmit(assignee: string, instruction: string, btn: HTMLButtonElement): void;
}

// FR-048 follow-up seed for an already-dispatched task: resume means "comment on the last
// output", not "re-send the full original instruction" (that is what the rounds history is for).
export const RESUME_SEED_ZH = '针对上次产出，补充意见：';

export function renderDelegatePanel(body: HTMLElement, t: T, opts: DelegatePanelOpts): void {
  const wrap = body.createDiv({ cls: 'tv-detail-delegate' });
  if (opts.dispatched) {
    wrap.createDiv({ cls: 'tv-delegate-resume', text: t('delegate.resumeBadge') });
  }
  const select = wrap.createEl('select');
  // AGENTS labels are brand names (CC/Codex/Hermes) and values are assignees written to
  // frontmatter — both data, not localized.
  for (const a of AGENTS) select.createEl('option', { text: a.label, attr: { value: a.value } });
  if (opts.assignee) select.value = opts.assignee;
  const instruction = wrap.createEl('textarea', { attr: { placeholder: t('delegate.placeholder') } });
  instruction.value = opts.dispatched && !opts.instruction ? RESUME_SEED_ZH : opts.instruction;
  instruction.addEventListener('input', () => opts.onInstructionChange?.(instruction.value));
  const btn = wrap.createEl('button', { cls: 'tv-btn tv-btn-cta', text: t('delegate.btn') });
  btn.addEventListener('click', () => {
    const text = instruction.value.trim();
    if (!text) {
      new Notice(t('delegate.emptyInstruction'));
      return;
    }
    opts.onSubmit(select.value, text, btn);
  });
}

// FireResult → user-facing notice. 只有真 fire 了 hook 才叫「已委派」——hook 空或炸了必须说出来，
// 否则 frontmatter 写了、agent 没起，用户以为交出去了（FR-021 回归）。
export function notifyDelegateResult(res: FireResult | 'error', assignee: string, t: T): void {
  if (res === 'fired') new Notice(t('delegate.fired', { assignee }));
  else if (res === 'disabled') new Notice(t('delegate.disabled', { assignee }), 10000);
  else new Notice(t('delegate.failed', { assignee }), 10000);
}
