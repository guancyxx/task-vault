// Sidebar cockpit ItemView (FR-011): five buckets rendered from the store, live-refreshed on
// store change. Section + sub-task collapse state is preserved across re-renders. Rows carry
// inline actions (FR-013) via TaskActions; sub-tasks render indented under their parent. The
// capture box (Task 9) mounts on top.

import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { TaskActions } from '../store/taskActions';
import type { Entry, TaskStore } from '../store/taskStore';
import type { Bucket } from '../time/timeRules';
import { openReschedule } from './reschedule';
import { parseCapture } from './captureParse';
import { openDetailAt } from './detailPopover';
import { renderTaskRow, type RowActions } from './taskRow';

// The view stays framework-thin: capture creates a file via this injected handler (VaultSource).
export type CaptureHandler = (text: string, now: Date) => Promise<void>;
// Detail popover opener (Task 13). Injected so this file stays independent of the popover.

export const VIEW_TYPE_TASK_VAULT = 'task-vault-view';

// Section order (user request 2026-08-20): overdue first — what's burning shows on top,
// before today. Then today, this week, done-today.
const SECTIONS: Array<{ bucket: Bucket; label: string }> = [
  { bucket: 'overdue', label: '过期' },
  { bucket: 'today', label: '今天' },
  { bucket: 'week', label: '本周' },
  { bucket: 'done', label: '今日完成' },
];

export class TaskVaultView extends ItemView {
  private collapsed = new Set<Bucket>(['done']); // 已完成 starts folded
  private collapsedParents = new Set<string>();
  private expandedProjects = new Set<string>(); // per-(bucket,project) expand memory; default folded
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private onCapture?: CaptureHandler,
    private actions?: TaskActions,
    private now: () => Date = () => new Date(),
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT;
  }

  getDisplayText(): string {
    return 'Task Vault';
  }

  getIcon(): string {
    return 'checkbox-glyph';
  }

  protected async onOpen(): Promise<void> {
    this.unsubscribe = this.store.onChange(() => this.render());
    this.render();
  }

  protected async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  render(): void {
    const root = this.containerEl;
    root.empty();
    root.addClass('tv-cockpit');
    this.renderCaptureBox(root);
    const grouped = this.store.bucketed(this.now());

    for (const { bucket, label } of SECTIONS) {
      const entries = grouped[bucket];
      const section = root.createDiv({ cls: ['tv-section', `tv-section-${bucket}`] });
      const folded = this.collapsed.has(bucket);

      const header = section.createDiv({ cls: 'tv-section-header' });
      header.createSpan({ cls: 'tv-fold', text: folded ? '▸' : '▾' });
      header.createSpan({ cls: 'tv-section-title', text: label });
      header.createSpan({ cls: 'tv-count', text: String(entries.length) });
      header.addEventListener('click', () => {
        if (folded) this.collapsed.delete(bucket);
        else this.collapsed.add(bucket);
        this.render();
      });

      if (folded) continue;
      const body = section.createDiv({ cls: 'tv-section-body' });
      // Top-level = no parent present in the store; sub-tasks render under their parent instead.
      const roots = entries.filter((e) => {
        const p = e.task.parent;
        return !p || !this.store.hasId(p);
      });
      if (roots.length === 0) {
        body.createDiv({ cls: 'tv-empty', text: '—' });
        continue;
      }
      // Project subgroups (user request 2026-08-19): rows are already group-sorted by
      // project+priority; insert a clickable divider whenever the project changes. Fold state
      // is per (bucket, project) — independent across sections — and defaults to folded.
      let lastProject: string | null = null;
      let currentCollapsed = false;
      for (const e of roots) {
        const proj = e.task.project
          ?? (e.task.tags ?? []).find((tg) => tg.startsWith('repo/'))?.slice(5)
          ?? '未分类';
        if (proj !== lastProject) {
          lastProject = proj;
          const key = `${bucket}\u0000${proj}`;
          currentCollapsed = !this.expandedProjects.has(key); // default folded
          const div = body.createDiv({ cls: 'tv-project-divider' });
          div.toggleClass('tv-collapsed', currentCollapsed);
          div.createSpan({ cls: 'tv-project-fold', text: currentCollapsed ? '▸' : '▾' });
          div.createSpan({ cls: 'tv-project-name', text: proj });
          div.createSpan({ cls: 'tv-project-count', text: String(projectCount(roots, proj)) });
          div.addEventListener('click', () => {
            if (this.expandedProjects.has(key)) this.expandedProjects.delete(key);
            else this.expandedProjects.add(key);
            this.render();
          });
        }
        if (currentCollapsed) continue;
        this.renderRowTree(body, e, false);
      }
    }
  }

  private renderRowTree(container: HTMLElement, entry: Entry, indent: boolean): void {
    const { task, path } = entry;
    const kids = this.store.children(task.id);
    const collapsed = this.collapsedParents.has(task.id);
    const child =
      kids.length > 0
        ? {
            count: kids.length,
            done: this.store.progress(task.id).done,
            collapsed,
            onToggle: () => {
              if (collapsed) this.collapsedParents.delete(task.id);
              else this.collapsedParents.add(task.id);
              this.render();
            },
          }
        : undefined;

    renderTaskRow(container, task, {
      path,
      effectiveStatus: this.store.effectiveStatus(task.id) ?? task.status,
      blockSources: this.store.blockSources(task.id),
      now: this.now(),
      actions: this.actions ? this.rowActions(path) : undefined,
      child,
      indent,
    });

    if (child && !collapsed) {
      for (const k of kids) this.renderRowTree(container, k, true);
    }
  }

  private rowActions(path: string): RowActions {
    const actions = this.actions!;
    return {
      complete: () => void actions.complete(path),
      reschedule: (task) => openReschedule(this.app, task.due, (due) => void actions.reschedule(path, due)),
      openDetail: (_task, evt) => openDetailAt(this.app, this.store, actions, path, evt),
      openDoc: (_task, p) => void this.app.workspace.openLinkText(p, '', false),
    };
  }

  // Quick-capture input (FR-012): Enter → parse → create task file → row appears via events.
  private renderCaptureBox(root: HTMLElement): void {
    if (!this.onCapture) return;
    const input = root.createEl('input', {
      cls: 'tv-capture',
      attr: { type: 'text', placeholder: '捕获任务…  !high @project #tag 明天下午3点' },
    });
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key !== 'Enter' || evt.isComposing) return; // let IME composition finish
      const text = input.value;
      const now = this.now();
      if (parseCapture(text, now) === null) {
        new Notice('任务标题为空');
        return;
      }
      input.value = '';
      void this.onCapture!(text, now).catch((e) => new Notice(`捕获失败：${String(e)}`));
    });
  }
}


// Root-row count per project within a bucket (for the divider's count badge).
function projectCount(roots: Entry[], project: string): number {
  let n = 0;
  for (const e of roots) {
    const p = e.task.project
      ?? (e.task.tags ?? []).find((tg) => tg.startsWith('repo/'))?.slice(5)
      ?? '未分类';
    if (p === project) n++;
  }
  return n;
}
