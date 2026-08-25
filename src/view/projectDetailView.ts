// Project detail ItemView (FR-035): opened in the center when a projects-panel card is clicked.
// Renders the project's tasks grouped by (effective) status, each group a renderTaskRow tree with
// the same interaction as the cockpit — checkbox complete, right-click detail popover, left-click
// open doc, sub-tasks nested under their parent. Header carries the project name + a 返回 button
// back to the projects panel. Live-refreshes on store change.

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { agentProgress } from '../model/agentProgress';
import { projectFolder, projectKey } from '../store/taskPaths';
import type { TaskActions } from '../store/taskActions';
import type { Entry, TaskStore } from '../store/taskStore';
import type { Status } from '../model/types';
import { createT, type T } from '../i18n';
import { openDetailAt } from './detailPopover';
import { openReschedule } from './reschedule';
import { renderTaskRow, statusLabel, type RowActions } from './taskRow';

export const VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL = 'task-vault-project-detail';

// Fallback translator when no getT is injected (never in production — the plugin always wires one).
const DEFAULT_T: T = createT('zh-CN');

// Group order (FR-035): live work first, blocked overlay, then the terminal archive at the bottom.
const GROUPS: readonly Status[] = ['review', 'doing', 'waiting', 'todo', 'inbox', 'blocked'];
const TERMINAL_GROUP: readonly Status[] = ['done', 'cancelled'];

export type OpenProjects = () => void;

// Display spelling for a detail view (audit 08-25, rounds 3-4): the view's `project` may hold
// either a display spelling (card click passes stat.display) or a legacy folded key (old
// workspace state). UI text must NEVER show a bare state string when it can't be verified —
// recover the first-seen original spelling from the store's actual tasks; when NO task matches,
// the project no longer exists in the vault (stale state, possibly holding a folded key), so
// return '' and let callers fall back to the generic localized title. Pure over entries.
export function projectDisplay(_project: string, entries: Entry[]): string {
  return entries.length > 0 ? projectFolder(entries[0].task) : '';
}

export class ProjectDetailView extends ItemView {
  private project = '';
  private collapsedParents = new Set<string>();
  private collapsedGroups = new Set<Status>(['done', 'cancelled']); // terminal starts folded
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private actions: TaskActions,
    private openProjects: OpenProjects,
    private getT: () => T = () => DEFAULT_T,
    private now: () => Date = () => new Date(),
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL;
  }

  getDisplayText(): string {
    const t = this.getT();
    // Recover the display spelling from the store (handles legacy folded-key states);
    // never render the folded key on the tab (audit 08-25 round 3).
    const entries = this.store.allEntries().filter((e) => projectKey(e.task) === this.project.toLowerCase());
    const display = projectDisplay(this.project, entries);
    return display ? t('projectDetail.title', { project: display }) : t('projectDetail.fallback');
  }

  getIcon(): string {
    return 'folder-open';
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const project = (state as { project?: string } | null)?.project;
    if (typeof project === 'string') this.project = project;
    await super.setState(state, result);
    this.render();
  }

  getState(): Record<string, unknown> {
    return { project: this.project };
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
    const t = this.getT();
    root.empty();
    root.addClass('tv-project-detail');

    // Every task filed under this project, keyed by the root task's effective status.
    // Case-folded identity (2026-08-25): a detail view opened for "Task Vault" also matches
    // tasks spelled task vault.
    const entries = this.store.allEntries().filter((e) => projectKey(e.task) === this.project?.toLowerCase());

    // Display keeps the FIRST-SEEN original spelling from the actual tasks (audit 08-25) —
    // never the folded identity key (Edu-Agent shows as "Edu-Agent", not edu-agent).
    const display = projectDisplay(this.project, entries);

    const header = root.createDiv({ cls: 'tv-proj-detail-header' });
    const back = header.createEl('button', { cls: 'tv-proj-back', text: t('projectDetail.back') });
    back.addEventListener('click', () => this.openProjects());
    header.createSpan({ cls: 'tv-proj-detail-title', text: display || t('projectDetail.fallback') });

    const roots = entries.filter((e) => {
      const p = e.task.parent;
      return !p || !this.store.hasId(p);
    });

    let rendered = 0;
    for (const status of [...GROUPS, ...TERMINAL_GROUP]) {
      const groupRoots = roots.filter((e) => (this.store.effectiveStatus(e.task.id) ?? e.task.status) === status);
      if (groupRoots.length === 0) continue;
      rendered += groupRoots.length;
      this.renderGroup(root, status, groupRoots);
    }
    if (rendered === 0) root.createDiv({ cls: 'tv-empty', text: t('projectDetail.empty') });
  }

  private renderGroup(root: HTMLElement, status: Status, groupRoots: Entry[]): void {
    const folded = this.collapsedGroups.has(status);
    const section = root.createDiv({ cls: ['tv-section', `tv-section-${status}`] });
    const header = section.createDiv({ cls: 'tv-section-header' });
    header.createSpan({ cls: 'tv-fold', text: folded ? '▸' : '▾' });
    header.createSpan({ cls: 'tv-section-title', text: statusLabel(status, this.getT()) });
    header.createSpan({ cls: 'tv-count', text: String(groupRoots.length) });
    header.addEventListener('click', () => {
      if (folded) this.collapsedGroups.delete(status);
      else this.collapsedGroups.add(status);
      this.render();
    });
    if (folded) return;
    const body = section.createDiv({ cls: 'tv-section-body' });
    for (const e of groupRoots) this.renderRowTree(body, e, false);
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
      actions: this.rowActions(path),
      child,
      indent,
      agentPhase: agentProgress(task, entry.body) ?? undefined,
      t: this.getT(),
    });

    if (child && !collapsed) {
      for (const k of kids) this.renderRowTree(container, k, true);
    }
  }

  private rowActions(path: string): RowActions {
    const actions = this.actions;
    return {
      complete: () => void actions.complete(path),
      reschedule: (task) => openReschedule(this.app, task.due, (due) => void actions.reschedule(path, due), this.getT()),
      openDetail: (_task, evt) => openDetailAt(this.app, this.store, actions, path, evt, this.getT()),
      openDoc: (_task, p) => void this.app.workspace.openLinkText(p, '', false),
      // FR-049: route the inline review decision through the canonical setStatus seam.
      reviewDecision: (_task, to) => void actions.setStatus(path, to),
    };
  }
}
