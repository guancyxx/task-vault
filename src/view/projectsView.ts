// Projects panel ItemView (FR-035): a right-side panel, parallel to the cockpit. On open it renders
// one card per project with全库统计 (open / overdue / weekDone / agents), busiest first. Clicking a
// card opens the project detail view in the center (injected openDetail). Live-refreshes on store
// change — same onChange subscription the cockpit uses.

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { projectStats, type ProjectStat } from '../model/projectStats';
import type { TaskStore } from '../store/taskStore';
import { createT, type T } from '../i18n';

export const VIEW_TYPE_TASK_VAULT_PROJECTS = 'task-vault-projects';

export type OpenProjectDetail = (project: string) => void;

// Fallback translator when no getT is injected (never in production — the plugin always wires one).
const DEFAULT_T: T = createT('zh-CN');

export class ProjectVaultView extends ItemView {
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private openDetail: OpenProjectDetail,
    private getT: () => T = () => DEFAULT_T,
    private now: () => Date = () => new Date(),
    private onOpenAgenda?: () => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT_PROJECTS;
  }

  getDisplayText(): string {
    return this.getT()('projects.title');
  }

  getIcon(): string {
    return 'folders';
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
    root.addClass('tv-projects');

    const header = root.createDiv({ cls: 'tv-proj-header' });
    header.createSpan({ cls: 'tv-proj-header-title', text: t('projects.title') });
    if (this.onOpenAgenda) {
      const link = header.createSpan({ cls: 'tv-projects-link', text: t('sidebar.agenda') });
      link.addEventListener('click', () => this.onOpenAgenda!());
    }

    const stats = projectStats(
      this.store.allEntries().map((e) => e.task),
      this.now(),
    );
    if (stats.length === 0) {
      root.createDiv({ cls: 'tv-empty', text: t('projects.empty') });
      return;
    }

    const grid = root.createDiv({ cls: 'tv-proj-grid' });
    for (const stat of stats) this.renderCard(grid, stat, t);
  }

  private renderCard(grid: HTMLElement, stat: ProjectStat, t: T): void {
    const card = grid.createDiv({ cls: 'tv-proj-card' });
    card.createDiv({ cls: 'tv-proj-name', text: stat.display }); // original spelling, not the folded key

    const metrics = card.createDiv({ cls: 'tv-proj-metrics' });
    metric(metrics, stat.open, t('projects.open'), 'open');
    metric(metrics, stat.overdue, t('projects.overdue'), stat.overdue > 0 ? 'overdue' : 'muted');
    metric(metrics, stat.weekDone, t('projects.weekDone'), 'muted');
    metric(metrics, stat.agents, t('projects.running'), stat.agents > 0 ? 'agents' : 'muted');

    card.addEventListener('click', () => this.openDetail(stat.project));
  }
}

// One big-number + small-label cell. `kind` selects the accent (open highlighted, overdue red).
function metric(parent: HTMLElement, value: number, label: string, kind: string): void {
  const cell = parent.createDiv({ cls: `tv-proj-metric tv-proj-metric-${kind}` });
  cell.createSpan({ cls: 'tv-proj-num', text: String(value) });
  cell.createSpan({ cls: 'tv-proj-label', text: label });
}
