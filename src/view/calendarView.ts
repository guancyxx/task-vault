// Calendar month-grid ItemView (FR-036): opened in the center from the agenda panel's 完整日历 button.
// 7-column Monday-start grid (5/6 rows) of the visible month. Each cell shows its day number and up to
// MAX_CHIPS task chips; a chip carries a status color bar (tv-status-<cls>, FR-031 同源) + a priority
// corner badge (p0-p3), grays out for terminal tasks, and opens the task document on click. Overflow
// collapses to a "+N" marker. Header: ‹ 当月标题 › + 今天 back-to-current button. Today's cell is
// highlighted; leading/trailing filler days (other months) are grayed. Clicking a day cell opens that
// day's daily note via openLinkText (the vault's native daily-note resolution). Live-refreshes on store
// change.

import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { monthGrid, type CalCell, type CalChip } from '../model/agendaGroup';
import type { TaskStore } from '../store/taskStore';
import { createT, type MessageKey, type ResolvedLang, type T } from '../i18n';
import { renderViewSwitch } from './viewSwitch';

export const VIEW_TYPE_TASK_VAULT_CALENDAR = 'task-vault-calendar';

const MAX_CHIPS = 3; // chips shown per cell before collapsing the rest into +N

// Dynamic i18n keys as literal-typed arrays (MessageKey is a union of literals, so a computed
// `'cal.month.' + n` string wouldn't type-check).
const MONTH_KEYS: readonly MessageKey[] = [
  'cal.month.0', 'cal.month.1', 'cal.month.2', 'cal.month.3', 'cal.month.4', 'cal.month.5',
  'cal.month.6', 'cal.month.7', 'cal.month.8', 'cal.month.9', 'cal.month.10', 'cal.month.11',
];
const WEEKDAY_KEYS: readonly MessageKey[] = [
  'cal.weekday.0', 'cal.weekday.1', 'cal.weekday.2', 'cal.weekday.3', 'cal.weekday.4',
  'cal.weekday.5', 'cal.weekday.6',
];

// Fallback translator when no getT is injected (never in production — the plugin always wires one).
const DEFAULT_T: T = createT('zh-CN');

export class CalendarVaultView extends ItemView {
  private viewDate: Date; // first-of-month anchor for the displayed month
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private getT: () => T = () => DEFAULT_T,
    private now: () => Date = () => new Date(),
    private getLang: () => ResolvedLang = () => 'zh-CN',
    private onOpenTasks?: () => void,
    private onOpenProjects?: () => void,
    private onOpenAgenda?: () => void,
  ) {
    super(leaf);
    const n = this.now();
    this.viewDate = new Date(n.getFullYear(), n.getMonth(), 1);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT_CALENDAR;
  }

  getDisplayText(): string {
    return this.getT()('cal.title');
  }

  getIcon(): string {
    return 'calendar';
  }

  protected async onOpen(): Promise<void> {
    this.unsubscribe = this.store.onChange(() => this.render());
    this.render();
  }

  protected async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  private shiftMonth(delta: number): void {
    this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + delta, 1);
    this.render();
  }

  private goToday(): void {
    const n = this.now();
    this.viewDate = new Date(n.getFullYear(), n.getMonth(), 1);
    this.render();
  }

  render(): void {
    const root = this.containerEl;
    const t = this.getT();
    root.empty();
    root.addClass('tv-calendar');

    // Cross-view switch bar (任务/项目/日程 three parallel links) — the calendar is reached from the
    // agenda, so it links back to all three panels (H7 tv-projects-link form). Links render only when
    // their handler is wired.
    if (this.onOpenTasks || this.onOpenProjects || this.onOpenAgenda) {
      renderViewSwitch(root.createDiv({ cls: 'tv-cockpit-header' }), t, {
        openTasks: this.onOpenTasks,
        openProjects: this.onOpenProjects,
        openAgenda: this.onOpenAgenda,
      });
    }

    this.renderHeader(root, t);
    this.renderWeekdays(root, t);

    const items = this.store.allEntries().map((e) => ({ task: e.task, path: e.path }));
    const cells = monthGrid(this.viewDate, items, this.now(), this.getLang());
    const grid = root.createDiv({ cls: 'tv-cal-grid' });
    for (const cell of cells) this.renderCell(grid, cell, t);
  }

  private renderHeader(root: HTMLElement, t: T): void {
    const header = root.createDiv({ cls: 'tv-cal-header' });
    const prev = header.createEl('button', { cls: 'tv-cal-nav', text: '‹', attr: { 'aria-label': t('cal.prevMonth') } });
    prev.addEventListener('click', () => this.shiftMonth(-1));

    const month = t(MONTH_KEYS[this.viewDate.getMonth()]);
    const title = t('cal.monthTitle', { month, year: this.viewDate.getFullYear() });
    header.createSpan({ cls: 'tv-cal-title', text: title });

    const next = header.createEl('button', { cls: 'tv-cal-nav', text: '›', attr: { 'aria-label': t('cal.nextMonth') } });
    next.addEventListener('click', () => this.shiftMonth(1));

    const today = header.createEl('button', { cls: 'tv-cal-today', text: t('cal.today') });
    today.addEventListener('click', () => this.goToday());
  }

  private renderWeekdays(root: HTMLElement, t: T): void {
    const row = root.createDiv({ cls: 'tv-cal-weekdays' });
    for (const key of WEEKDAY_KEYS) row.createSpan({ cls: 'tv-cal-weekday', text: t(key) });
  }

  private renderCell(grid: HTMLElement, cell: CalCell, t: T): void {
    const el = grid.createDiv({ cls: 'tv-cal-cell' });
    el.toggleClass('tv-cal-out', !cell.inMonth);
    el.toggleClass('tv-cal-today', cell.isToday);
    el.createSpan({ cls: 'tv-cal-daynum', text: String(cell.date.getDate()) });
    // Click empty space in the cell → open that day's daily note (native link resolution).
    el.addEventListener('click', () => void this.app.workspace.openLinkText(cell.key, '', false).catch(() => {}));

    const shown = cell.chips.slice(0, MAX_CHIPS);
    for (const chip of shown) this.renderChip(el, chip);
    if (cell.chips.length > MAX_CHIPS) {
      el.createDiv({ cls: 'tv-cal-more', text: t('cal.more', { n: cell.chips.length - MAX_CHIPS }) });
    }
  }

  private renderChip(cell: HTMLElement, chip: CalChip): void {
    // Effective status (blocked derivation is the store's job, FR-031 同源); the pure fn keeps raw
    // status in chip.cls. Terminal chips are never blocked, so this is a no-op for them.
    const cls = this.store.effectiveStatus(chip.task.id) ?? chip.cls;
    const el = cell.createDiv({ cls: `tv-cal-chip tv-status-${cls}` });
    el.toggleClass('tv-cal-chip-done', chip.terminal);
    el.createSpan({ cls: `tv-cal-pri tv-pri-${chip.priority}`, text: chip.priority });
    el.createSpan({ cls: 'tv-cal-chip-title', text: (chip.time ? `${chip.time} ` : '') + chip.task.title });
    el.setAttribute('title', chip.task.title);
    el.addEventListener('click', (evt) => {
      evt.stopPropagation(); // don't also open the day's daily note
      void this.app.workspace.openLinkText(chip.path, '', false).catch(() => {});
    });
  }
}
