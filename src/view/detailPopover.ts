// Task detail popover (FR-014, FR-015, SC-009/010). A Modal opened by right-clicking a row.
// Scope narrowed by user request 2026-08-19 to three panels — 状态更改 / 快速填入 / 委派 — plus a
// footer that hands a ready-to-paste delegation prompt to an agent. Property editing moved out
// (dates still edit from the row's date chip); 打开文件 dropped because a left click already
// opens the doc. All writes route through TaskActions (the tested seam); this file is DOM wiring,
// verified in docs/manual-check-d.md. A local task copy is edited optimistically and re-rendered
// so the panel reflects each change without waiting on the store's debounced file events.

import { FileSystemAdapter, Modal, Notice, type App } from 'obsidian';
import type { EntryKind } from '../log/executionLog';
import { TRANSITIONS } from '../model/statusMachine';
import type { Status, Task } from '../model/types';
import type { TaskActions } from '../store/taskActions';
import type { TaskStore } from '../store/taskStore';
import type { MessageKey, T } from '../i18n';
import { STATUS_META, statusLabel } from './taskRow';
import { buildTaskPrompt, obsidianUri } from './taskPrompt';
import { notifyDelegateResult, renderDelegatePanel } from './delegatePanel';

// Quick-fill entry kinds; plain progress carries no kind. Shared with quickLogModal (FR-027).
// `value` is the EntryKind written to the file (data — never localized); `labelKey` is the
// dictionary key for the select option shown to the user (FR-039).
export const KINDS: Array<{ value: '' | EntryKind; labelKey: MessageKey }> = [
  { value: '', labelKey: 'kind.progress' },
  { value: '决策', labelKey: 'kind.decision' },
  { value: '评论', labelKey: 'kind.comment' },
  { value: '卡点', labelKey: 'kind.blocker' },
];

export function openDetail(app: App, store: TaskStore, actions: TaskActions, path: string, t: T): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(t('detail.notFound'));
    return;
  }
  new DetailModal(app, actions, path, entry.task, t).open();
}

// Right-click entry: same modal, opened from a row contextmenu (user request 2026-08-19).
// The evt is accepted so callers can anchor menus later; the modal itself is centered.
export function openDetailAt(app: App, store: TaskStore, actions: TaskActions, path: string, _evt: MouseEvent, t: T): void {
  openDetail(app, store, actions, path, t);
}

class DetailModal extends Modal {
  // Held across re-renders so a delegation instruction survives the status/quick-fill redraws
  // and can also feed the copied prompt.
  private instruction = '';

  constructor(app: App, private actions: TaskActions, private path: string, private task: Task, private t: T) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    this.setTitle(this.task.title);
    this.renderStatus(contentEl);
    this.renderQuickFill(contentEl);
    this.renderDelegation(contentEl);
    this.renderFooter(contentEl);
  }

  // Card shell shared by the three panels; returns the body to fill.
  private panel(parent: HTMLElement, title: string, statusCls?: string): HTMLElement {
    const cls = ['tv-panel'];
    if (statusCls) cls.push(`tv-status-${statusCls}`);
    const card = parent.createDiv({ cls });
    card.createDiv({ cls: 'tv-panel-title', text: title });
    return card.createDiv({ cls: 'tv-panel-body' });
  }

  // 状态更改: current state chip + one button per legal target (no nested menu).
  private renderStatus(parent: HTMLElement): void {
    const t = this.t;
    const meta = STATUS_META[this.task.status];
    const body = this.panel(parent, t('panel.status'), meta.cls);
    body.createSpan({
      cls: `tv-chip tv-chip-now tv-chip-${meta.cls}`,
      text: `${meta.glyph} ${statusLabel(this.task.status, t)}`,
    });
    const targets = TRANSITIONS[this.task.status];
    if (targets.length === 0) {
      body.createSpan({ cls: 'tv-hint', text: t('detail.terminalNoTransition') });
      return;
    }
    body.createSpan({ cls: 'tv-arrow', text: '→' });
    for (const to of targets) {
      const btn = body.createEl('button', {
        cls: `tv-chip tv-chip-btn tv-chip-${STATUS_META[to].cls}`,
        text: `${STATUS_META[to].glyph} ${statusLabel(to, t)}`,
      });
      btn.addEventListener('click', () => this.setStatus(to));
    }
  }

  private setStatus(to: Status): void {
    this.task = { ...this.task, status: to };
    void this.actions.setStatus(this.path, to);
    this.render();
  }

  // 快速填入 (SC-010): kind select + one line → append to 执行记录. Enter OR the 填入 button
  // commits — the button was missing, which made the panel read as decorative (user report).
  private renderQuickFill(parent: HTMLElement): void {
    const t = this.t;
    const body = this.panel(parent, t('panel.quickFill'));
    const row = body.createDiv({ cls: 'tv-detail-quick' });
    const select = row.createEl('select');
    for (const k of KINDS) select.createEl('option', { text: t(k.labelKey), attr: { value: k.value } });
    const input = row.createEl('input', { attr: { type: 'text', placeholder: t('detail.quickPlaceholder') } });
    const btn = row.createEl('button', { cls: 'tv-btn tv-btn-cta', text: t('detail.fillBtn') });

    const submit = (): void => {
      const text = input.value.trim();
      if (!text) {
        new Notice(t('detail.emptyContent'));
        input.focus();
        return;
      }
      const kind = (select.value || undefined) as EntryKind | undefined;
      void this.actions.appendQuick(this.path, text, kind);
      input.value = '';
      input.focus();
      new Notice(t('detail.wroteLog'));
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      submit();
    });
  }

  // 委派 (FR-015): agent select + instruction → 委派 section + assignee/dispatched + dispatch hook.
  // Panel DOM + result notices are shared with the 委派 command via delegatePanel; this callback
  // adds the popover-specific bits (optimistic assignee, re-render).
  private renderDelegation(parent: HTMLElement): void {
    const t = this.t;
    const body = this.panel(parent, t('panel.delegate'));
    renderDelegatePanel(body, t, {
      assignee: this.task.assignee,
      instruction: this.instruction,
      dispatched: Boolean(this.task.dispatched),
      onInstructionChange: (v) => {
        this.instruction = v;
      },
      onSubmit: (assignee, text, btn) => {
        this.task = { ...this.task, assignee };
        btn.disabled = true;
        void this.actions.delegate(this.path, assignee, text).then((res) => {
          btn.disabled = false;
          notifyDelegateResult(res, assignee, t);
          this.render();
        });
      },
    });
  }

  private renderFooter(parent: HTMLElement): void {
    const t = this.t;
    const footer = parent.createDiv({ cls: 'tv-detail-footer' });

    const prompt = footer.createEl('button', { cls: 'tv-btn tv-btn-cta', text: t('detail.copyPrompt') });
    prompt.addEventListener('click', () => {
      void navigator.clipboard.writeText(
        buildTaskPrompt({
          task: this.task,
          path: this.path,
          vaultName: this.app.vault.getName(),
          basePath: this.basePath(),
        }),
      );
      new Notice(t('detail.copiedPrompt'));
    });

    const copy = footer.createEl('button', { cls: 'tv-btn', text: t('detail.copyLink') });
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(obsidianUri(this.app.vault.getName(), this.path));
      new Notice(t('detail.copiedLink'));
    });

    const summary = footer.createEl('button', { cls: 'tv-btn', text: t('detail.summary') });
    summary.addEventListener('click', () => void this.actions.manualSummary(this.path));
  }

  // Absolute vault root so the prompt can hand agents a path they can open directly.
  private basePath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }
}
