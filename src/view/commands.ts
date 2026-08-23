// H3 (FR-032, SC-013): the six command-palette entry points + default hotkeys (Mod+Shift with
// L/D/C/K/S/A). Every command is checkCallback-gated on "the active editor file is an indexed
// task", so all six grey out on any non-task file. All writes route through TaskActions
// (appendQuick / setStatus / delegate) — the same canonical seam the sidebar popover uses, so a
// command and a popover click produce byte-identical results. Defaults are re-bindable in
// Settings → Hotkeys.

import { Modal, Notice, type App, type Command, type Plugin } from 'obsidian';
import type { Status } from '../model/types';
import type { TaskActions } from '../store/taskActions';
import type { TaskStore } from '../store/taskStore';
import type { MessageKey, T } from '../i18n';
import { notifyDelegateResult, renderDelegatePanel } from './delegatePanel';
import { openAnnotate, openQuickLog } from './quickLogModal';
import { STATUS_META, statusLabel, statusTargets, type StatusTarget } from './taskRow';

// Card shell matching the detail popover's panels (tv-panel / -title / -body). Kept local — the
// popover's own copy is a private method and not worth churning to share four lines.
function panel(parent: HTMLElement, title: string, statusCls?: string): HTMLElement {
  const cls = ['tv-panel'];
  if (statusCls) cls.push(`tv-status-${statusCls}`);
  const card = parent.createDiv({ cls });
  card.createDiv({ cls: 'tv-panel-title', text: title });
  return card.createDiv({ cls: 'tv-panel-body' });
}

// 设置状态 command: pick a legal target for the active task. Only `done` is truly
// exit-less (TRANSITIONS.done = []); `cancelled` still offers 重开 → todo, so it must
// reach the modal, not a dead-end notice.
class SetStatusModal extends Modal {
  constructor(
    app: App,
    private actions: TaskActions,
    private path: string,
    private title: string,
    private status: Status,
    private targets: StatusTarget[],
    private t: T,
  ) {
    super(app);
  }

  onOpen(): void {
    const t = this.t;
    this.setTitle(t('cmd.setStatusTitle', { title: this.title }));
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const body = panel(contentEl, t('panel.status'), STATUS_META[this.status].cls);
    body.createSpan({
      cls: `tv-chip tv-chip-now tv-chip-${STATUS_META[this.status].cls}`,
      text: `${STATUS_META[this.status].glyph} ${statusLabel(this.status, t)}`,
    });
    body.createSpan({ cls: 'tv-arrow', text: '→' });
    for (const t of this.targets) {
      const btn = body.createEl('button', {
        cls: `tv-chip tv-chip-btn tv-chip-${t.cls}`,
        text: `${t.glyph} ${t.label}`,
      });
      btn.addEventListener('click', () => {
        void this.actions.setStatus(this.path, t.to);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function openSetStatus(app: App, store: TaskStore, actions: TaskActions, path: string, t: T): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(t('cmd.notIndexed'));
    return;
  }
  const targets = statusTargets(entry.task.status, t);
  if (targets.length === 0) {
    new Notice(t('cmd.noTargets', { label: statusLabel(entry.task.status, t) }));
    return;
  }
  new SetStatusModal(app, actions, path, entry.task.title, entry.task.status, targets, t).open();
}

// 委派 command: the shared delegation panel in a standalone modal (vs. inside the detail popover).
class DelegateModal extends Modal {
  private instruction = '';

  constructor(
    app: App,
    private actions: TaskActions,
    private path: string,
    private title: string,
    private t: T,
    private assignee?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const t = this.t;
    this.setTitle(t('cmd.delegateTitle', { title: this.title }));
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const body = panel(contentEl, t('panel.delegate'));
    renderDelegatePanel(body, t, {
      assignee: this.assignee,
      instruction: this.instruction,
      onInstructionChange: (v) => {
        this.instruction = v;
      },
      onSubmit: (assignee, text, btn) => {
        btn.disabled = true;
        void this.actions.delegate(this.path, assignee, text).then((res) => {
          notifyDelegateResult(res, assignee, t);
          this.close();
        });
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function openDelegate(app: App, store: TaskStore, actions: TaskActions, path: string, t: T): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(t('cmd.notIndexed'));
    return;
  }
  new DelegateModal(app, actions, path, entry.task.title, t, entry.task.assignee).open();
}

// Register all six commands. Each shares one checkCallback gate: enabled only when the active
// editor file is a task the store has indexed. Default hotkeys are Mod+Shift + the given letter.

// Pure command table (single source for ids, dictionary keys, and default hotkey letters).
// Exported for tests — registration iterates this, so the shipped commands can never drift from
// the spec. `id` + `key` are the contract fields (unchanged); the display name resolves via
// `nameKey` through the active translator (FR-039).
export interface CommandRow {
  id: string;
  nameKey: MessageKey;
  key: string;
}

export const COMMAND_ROWS: readonly CommandRow[] = [
  { id: 'quick-log', nameKey: 'cmd.quickLog', key: 'L' },
  { id: 'log-decision', nameKey: 'cmd.logDecision', key: 'D' },
  { id: 'log-comment', nameKey: 'cmd.logComment', key: 'C' },
  { id: 'log-blocker', nameKey: 'cmd.logBlocker', key: 'K' },
  { id: 'set-status', nameKey: 'cmd.setStatus', key: 'S' },
  { id: 'delegate', nameKey: 'cmd.delegate', key: 'A' },
] as const;

// Pure gate: resolves the active path to an indexed task path, or null. Extracted so the
// checkCallback behavior (grey-out on non-task files) is unit-testable without Obsidian.
export function commandGate(
  store: Pick<TaskStore, 'entryByPath'>,
  activePath: string | null,
): string | null {
  if (!activePath) return null;
  return store.entryByPath(activePath) ? activePath : null;
}

// `getT` is read at command-invocation time (not captured) so a language switch takes effect
// without re-registering the runners. Returns the six Command objects so the caller can relabel
// their `.name` on a language switch (see relabelCommands in main.ts).
export function registerCommands(
  plugin: Plugin,
  app: App,
  store: TaskStore,
  actions: TaskActions,
  getT: () => T,
): Command[] {
  const runners: Record<string, (path: string) => void> = {
    'quick-log': (p) => openQuickLog(app, store, actions, p, getT()),
    'log-decision': (p) => openAnnotate(app, store, actions, p, '决策', getT()),
    'log-comment': (p) => openAnnotate(app, store, actions, p, '评论', getT()),
    'log-blocker': (p) => openAnnotate(app, store, actions, p, '卡点', getT()),
    'set-status': (p) => openSetStatus(app, store, actions, p, getT()),
    delegate: (p) => openDelegate(app, store, actions, p, getT()),
  };
  return COMMAND_ROWS.map((row) =>
    plugin.addCommand({
      id: row.id,
      name: getT()(row.nameKey),
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: row.key }],
      checkCallback: (checking: boolean) => {
        const file = app.workspace.getActiveFile();
        const path = commandGate(store, file ? file.path : null);
        if (!path) return false;
        if (!checking) runners[row.id](path);
        return true;
      },
    }),
  );
}
