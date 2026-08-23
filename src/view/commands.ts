// H3 (FR-032, SC-013): the six command-palette entry points + default hotkeys (Mod+Shift with
// L/D/C/K/S/A). Every command is checkCallback-gated on "the active editor file is an indexed
// task", so all six grey out on any non-task file. All writes route through TaskActions
// (appendQuick / setStatus / delegate) — the same canonical seam the sidebar popover uses, so a
// command and a popover click produce byte-identical results. Defaults are re-bindable in
// Settings → Hotkeys.

import { Modal, Notice, type App, type Plugin } from 'obsidian';
import type { Status } from '../model/types';
import type { TaskActions } from '../store/taskActions';
import type { TaskStore } from '../store/taskStore';
import { notifyDelegateResult, renderDelegatePanel } from './delegatePanel';
import { openAnnotate, openQuickLog } from './quickLogModal';
import { STATUS_LABEL, STATUS_META, statusTargets, type StatusTarget } from './taskRow';

const NOT_INDEXED = '当前文件不是任务文件（无 frontmatter id，未被 Task Vault 索引）';

// Card shell matching the detail popover's panels (tv-panel / -title / -body). Kept local — the
// popover's own copy is a private method and not worth churning to share four lines.
function panel(parent: HTMLElement, title: string, statusCls?: string): HTMLElement {
  const cls = ['tv-panel'];
  if (statusCls) cls.push(`tv-status-${statusCls}`);
  const card = parent.createDiv({ cls });
  card.createDiv({ cls: 'tv-panel-title', text: title });
  return card.createDiv({ cls: 'tv-panel-body' });
}

// 设置状态 command: pick a legal target for the active task. Terminal states never reach the
// modal — the caller Notices instead (below).
class SetStatusModal extends Modal {
  constructor(
    app: App,
    private actions: TaskActions,
    private path: string,
    private title: string,
    private status: Status,
    private targets: StatusTarget[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`设置状态 · ${this.title}`);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const body = panel(contentEl, '状态更改', STATUS_META[this.status].cls);
    body.createSpan({
      cls: `tv-chip tv-chip-now tv-chip-${STATUS_META[this.status].cls}`,
      text: `${STATUS_META[this.status].glyph} ${STATUS_LABEL[this.status]}`,
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

function openSetStatus(app: App, store: TaskStore, actions: TaskActions, path: string): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(NOT_INDEXED);
    return;
  }
  const targets = statusTargets(entry.task.status);
  if (targets.length === 0) {
    new Notice(`「${STATUS_LABEL[entry.task.status]}」是终态，无可转移目标`);
    return;
  }
  new SetStatusModal(app, actions, path, entry.task.title, entry.task.status, targets).open();
}

// 委派 command: the shared delegation panel in a standalone modal (vs. inside the detail popover).
class DelegateModal extends Modal {
  private instruction = '';

  constructor(
    app: App,
    private actions: TaskActions,
    private path: string,
    private title: string,
    private assignee?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(`委派 · ${this.title}`);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const body = panel(contentEl, '委派');
    renderDelegatePanel(body, {
      assignee: this.assignee,
      instruction: this.instruction,
      onInstructionChange: (v) => {
        this.instruction = v;
      },
      onSubmit: (assignee, text, btn) => {
        btn.disabled = true;
        void this.actions.delegate(this.path, assignee, text).then((res) => {
          notifyDelegateResult(res, assignee);
          this.close();
        });
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function openDelegate(app: App, store: TaskStore, actions: TaskActions, path: string): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(NOT_INDEXED);
    return;
  }
  new DelegateModal(app, actions, path, entry.task.title, entry.task.assignee).open();
}

// Register all six commands. Each shares one checkCallback gate: enabled only when the active
// editor file is a task the store has indexed. Default hotkeys are Mod+Shift + the given letter.
export function registerCommands(
  plugin: Plugin,
  app: App,
  store: TaskStore,
  actions: TaskActions,
): void {
  const gated = (id: string, name: string, key: string, run: (path: string) => void): void => {
    plugin.addCommand({
      id,
      name,
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key }],
      checkCallback: (checking: boolean) => {
        const file = app.workspace.getActiveFile();
        if (!file) return false;
        const path = file.path;
        // Gate on the store index, not a path heuristic: only indexed task files get the command.
        if (!store.entryByPath(path)) return false;
        if (!checking) run(path);
        return true;
      },
    });
  };

  gated('quick-log', '记一条执行记录', 'L', (p) => openQuickLog(app, store, actions, p));
  gated('log-decision', '快捷标注 · 决策', 'D', (p) => openAnnotate(app, store, actions, p, '决策'));
  gated('log-comment', '快捷标注 · 评论', 'C', (p) => openAnnotate(app, store, actions, p, '评论'));
  gated('log-blocker', '快捷标注 · 卡点', 'K', (p) => openAnnotate(app, store, actions, p, '卡点'));
  gated('set-status', '设置状态', 'S', (p) => openSetStatus(app, store, actions, p));
  gated('delegate', '委派', 'A', (p) => openDelegate(app, store, actions, p));
}
