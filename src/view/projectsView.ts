// Projects panel ItemView (FR-035): a right-side panel, parallel to the cockpit. On open it renders
// one card per project with全库统计 (open / overdue / weekDone / agents), busiest first. Clicking a
// card opens the project detail view in the center (injected openDetail). Live-refreshes on store
// change — same onChange subscription the cockpit uses.

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { projectStats, type ProjectStat } from '../model/projectStats';
import type { TaskStore } from '../store/taskStore';

export const VIEW_TYPE_TASK_VAULT_PROJECTS = 'task-vault-projects';

export type OpenProjectDetail = (project: string) => void;

export class ProjectVaultView extends ItemView {
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private openDetail: OpenProjectDetail,
    private now: () => Date = () => new Date(),
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT_PROJECTS;
  }

  getDisplayText(): string {
    return '项目面板';
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
    root.empty();
    root.addClass('tv-projects');

    const header = root.createDiv({ cls: 'tv-proj-header' });
    header.createSpan({ cls: 'tv-proj-header-title', text: '项目面板' });

    const stats = projectStats(
      this.store.allEntries().map((e) => e.task),
      this.now(),
    );
    if (stats.length === 0) {
      root.createDiv({ cls: 'tv-empty', text: '暂无项目' });
      return;
    }

    const grid = root.createDiv({ cls: 'tv-proj-grid' });
    for (const stat of stats) this.renderCard(grid, stat);
  }

  private renderCard(grid: HTMLElement, stat: ProjectStat): void {
    const card = grid.createDiv({ cls: 'tv-proj-card' });
    card.createDiv({ cls: 'tv-proj-name', text: stat.project });

    const metrics = card.createDiv({ cls: 'tv-proj-metrics' });
    metric(metrics, stat.open, '开放', 'open');
    metric(metrics, stat.overdue, '过期', stat.overdue > 0 ? 'overdue' : 'muted');
    metric(metrics, stat.weekDone, '本周完成', 'muted');
    metric(metrics, stat.agents, '在跑', stat.agents > 0 ? 'agents' : 'muted');

    card.addEventListener('click', () => this.openDetail(stat.project));
  }
}

// One big-number + small-label cell. `kind` selects the accent (open highlighted, overdue red).
function metric(parent: HTMLElement, value: number, label: string, kind: string): void {
  const cell = parent.createDiv({ cls: `tv-proj-metric tv-proj-metric-${kind}` });
  cell.createSpan({ cls: 'tv-proj-num', text: String(value) });
  cell.createSpan({ cls: 'tv-proj-label', text: label });
}
