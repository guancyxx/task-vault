// Agenda panel ItemView (FR-036): a right-side panel showing today's timeline. Timed items (with a
// HH:MM) sort by time on top, all-day items after; a non-terminal item already past its time renders
// red (tv-overdue, same semantics as the cockpit). Done/cancelled tasks completed today collapse into
// a folded terminal group at the bottom (mirrors the project detail view's terminal group). A top
// button opens the full month calendar in the center. Live-refreshes on store change.

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { todayAgenda, type AgendaItem, type TodayAgenda } from '../model/agendaGroup';
import type { TaskStore } from '../store/taskStore';
import { createT, type T } from '../i18n';

export const VIEW_TYPE_TASK_VAULT_AGENDA = 'task-vault-agenda';

// Fallback translator when no getT is injected (never in production — the plugin always wires one).
const DEFAULT_T: T = createT('zh-CN');

export type OpenCalendar = () => void;

export class AgendaVaultView extends ItemView {
  private doneFolded = true; // terminal group starts folded (same as project detail)
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private openCalendar: OpenCalendar,
    private getT: () => T = () => DEFAULT_T,
    private now: () => Date = () => new Date(),
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT_AGENDA;
  }

  getDisplayText(): string {
    return this.getT()('agenda.title');
  }

  getIcon(): string {
    return 'calendar-clock';
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
    root.addClass('tv-agenda');

    const header = root.createDiv({ cls: 'tv-agenda-header' });
    header.createSpan({ cls: 'tv-agenda-title', text: t('agenda.title') });
    const calBtn = header.createEl('button', { cls: 'tv-cal-open', text: t('agenda.fullCalendar') });
    calBtn.addEventListener('click', () => this.openCalendar());

    const items = this.store.allEntries().map((e) => ({ task: e.task, path: e.path }));
    const agenda = todayAgenda(items, this.now());

    if (agenda.timed.length === 0 && agenda.allDay.length === 0 && agenda.done.length === 0) {
      root.createDiv({ cls: 'tv-empty', text: t('agenda.empty') });
      return;
    }

    const timeline = root.createDiv({ cls: 'tv-timeline' });
    for (const item of agenda.timed) this.renderItem(timeline, item, t);
    if (agenda.allDay.length > 0) {
      timeline.createDiv({ cls: 'tv-timeline-label', text: t('agenda.allDay') });
      for (const item of agenda.allDay) this.renderItem(timeline, item, t);
    }

    if (agenda.done.length > 0) this.renderDoneGroup(root, agenda, t);
  }

  private renderItem(timeline: HTMLElement, item: AgendaItem, t: T): void {
    const row = timeline.createDiv({ cls: `tv-tl-row tv-status-${item.task.status}` });
    row.toggleClass('tv-overdue', item.overdue);
    row.createSpan({ cls: 'tv-tl-time', text: item.time ?? t('agenda.allDay') });
    row.createSpan({ cls: 'tv-tl-title', text: item.task.title });
    row.addEventListener('click', () => void this.app.workspace.openLinkText(item.path, '', false));
  }

  private renderDoneGroup(root: HTMLElement, agenda: TodayAgenda, t: T): void {
    const section = root.createDiv({ cls: 'tv-section tv-section-done' });
    const header = section.createDiv({ cls: 'tv-section-header' });
    header.createSpan({ cls: 'tv-fold', text: this.doneFolded ? '▸' : '▾' });
    header.createSpan({ cls: 'tv-section-title', text: t('agenda.doneGroup') });
    header.createSpan({ cls: 'tv-count', text: String(agenda.done.length) });
    header.addEventListener('click', () => {
      this.doneFolded = !this.doneFolded;
      this.render();
    });
    if (this.doneFolded) return;
    const body = section.createDiv({ cls: 'tv-section-body tv-timeline' });
    for (const item of agenda.done) {
      const row = body.createDiv({ cls: `tv-tl-row tv-tl-done tv-status-${item.task.status}` });
      row.createSpan({ cls: 'tv-tl-time', text: (item.task.completed ?? '').slice(11, 16) || '—' });
      row.createSpan({ cls: 'tv-tl-title', text: item.task.title });
      row.addEventListener('click', () => void this.app.workspace.openLinkText(item.path, '', false));
    }
  }
}
