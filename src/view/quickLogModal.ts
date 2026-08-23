// Quick-log modal (FR-027, SC-011): the popover's 快速填入 panel, opened against the file
// currently active in the editor via the command palette / hotkey. Writes through the same
// canonical seam (appendQuick → executionLog.formatEntry → atomic section upsert), so entries
// land byte-identical to the sidebar popover's — the fix for "editing a task doc means
// hand-writing the fixed format".
//
// Why a separate tiny modal instead of reusing DetailModal: the popover is bound to a sidebar
// row's path and owns a three-panel re-render loop; here the target is "whatever task file is
// open in the editor", and the modal should commit and get out of the way.

import { Modal, Notice, type App } from 'obsidian';
import type { EntryKind } from '../log/executionLog';
import type { TaskActions } from '../store/taskActions';
import type { TaskStore } from '../store/taskStore';
import { KINDS } from './detailPopover';

const NOT_A_TASK = '当前文件不是任务文件（无 frontmatter id，未被 Task Vault 索引）';

export function openQuickLog(app: App, store: TaskStore, actions: TaskActions, path: string): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(NOT_A_TASK);
    return;
  }
  new QuickLogModal(app, actions, path, entry.task.title).open();
}

// Quick-annotate commands (FR-032): kind is fixed (决策/评论/卡点), so the same modal drops the
// type select and shows the kind in its title — user types one line, Enter commits.
export function openAnnotate(
  app: App,
  store: TaskStore,
  actions: TaskActions,
  path: string,
  kind: EntryKind,
): void {
  const entry = store.entryByPath(path);
  if (!entry) {
    new Notice(NOT_A_TASK);
    return;
  }
  new QuickLogModal(app, actions, path, entry.task.title, kind).open();
}

class QuickLogModal extends Modal {
  constructor(
    app: App,
    private actions: TaskActions,
    private path: string,
    private title: string,
    // When set the kind is fixed (annotate command): no select, kind shown in the title.
    private fixedKind?: EntryKind,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail'); // reuse the popover's panel/input/button styles wholesale
    const card = contentEl.createDiv({ cls: 'tv-panel' });
    const body = card.createDiv({ cls: 'tv-panel-body' });
    const row = body.createDiv({ cls: 'tv-detail-quick' });

    let select: HTMLSelectElement | undefined;
    if (this.fixedKind) {
      this.setTitle(`快捷标注 · ${this.fixedKind}`);
      card.createDiv({ cls: 'tv-panel-title', text: '快捷标注 → ## 执行记录' });
    } else {
      this.setTitle(`记一条 · ${this.title}`);
      card.createDiv({ cls: 'tv-panel-title', text: '快速填入 → ## 执行记录' });
      select = row.createEl('select');
      for (const k of KINDS) select.createEl('option', { text: k.label, attr: { value: k.value } });
    }
    const input = row.createEl('input', {
      attr: { type: 'text', placeholder: '记一条…回车提交' },
    });
    const btn = row.createEl('button', { cls: 'tv-btn tv-btn-cta', text: '填入' });

    // Unlike the popover panel (stays open for chains), this modal closes after commit:
    // it was summoned mid-editing — the user wants to be back in the prose, one Esc away
    // if they change their mind. Enter is guarded for IME composition (Chinese input).
    const submit = (): void => {
      const text = input.value.trim();
      if (!text) {
        new Notice('先写点内容');
        input.focus();
        return;
      }
      const kind = this.fixedKind ?? ((select?.value || undefined) as EntryKind | undefined);
      void this.actions.appendQuick(this.path, text, kind).then(
        () => {
          new Notice('已写入执行记录（区首）');
          this.close();
        },
        (e: unknown) => new Notice(`写入失败：${String(e)}`),
      );
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      submit();
    });
    window.setTimeout(() => input.focus());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
