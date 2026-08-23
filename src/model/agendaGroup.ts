// H8 日程/日历 纯派生层 (FR-036). Zero obsidian dependency so it unit-tests against plain tasks.
// Two questions, both "what day does a task belong to":
//   todayAgenda — today's timeline: timed (has HH:MM) sorted by time, all-day after; overdue红 flag.
//   monthGrid   — Monday-start month grid; each task lands on a cell (non-terminal by due, terminal
//                 by completed date, grayed), chips sorted timed→all-day→title.
// Overdue reuses timeRules.isOverdue so the 过期 semantics match the cockpit/项目面板 exactly.

import { isOverdue } from '../time/timeRules';
import { TERMINAL_STATUSES, type Task } from './types';

// Minimal input carrying the vault path so chips/items can open the task document without a store.
export interface DatedTask {
  task: Task;
  path: string;
}

export interface AgendaItem {
  task: Task;
  path: string;
  time?: string; // HH:MM for timed items; undefined for all-day
  overdue: boolean; // 非终态 timed 已过 now → tv-overdue 红
}

export interface TodayAgenda {
  timed: AgendaItem[]; // due today with a time, sorted by time asc
  allDay: AgendaItem[]; // due today, date-only, after the timed block
  done: AgendaItem[]; // done/cancelled completed today (folded group)
}

export interface CalChip {
  task: Task;
  path: string;
  cls: string; // status class → tv-status-<cls> (FR-031 同源)
  priority: string; // p0-p3 角标
  time?: string; // HH:MM when the task lands here by a timed due
  terminal: boolean; // placed by completed date → grayed
}

export interface CalCell {
  date: Date;
  key: string; // YYYY-MM-DD
  inMonth: boolean; // false for the leading/trailing filler days (grayed)
  isToday: boolean;
  chips: CalChip[];
}

const PRIORITY_TAG: Record<string, string> = { high: 'p0', normal: 'p1', low: 'p2' };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isTerminal(task: Task): boolean {
  return TERMINAL_STATUSES.includes(task.status);
}

function timeOf(due: string): string | undefined {
  return due.includes('T') ? due.split('T')[1].slice(0, 5) : undefined;
}

function priTag(task: Task): string {
  return task.priority ? PRIORITY_TAG[task.priority] ?? 'p3' : 'p3';
}

// FR-036 今日时间轴分组: timed 按时刻升序在前、all-day 靠后、终态今日完结折叠组。
export function todayAgenda(items: readonly DatedTask[], now: Date): TodayAgenda {
  const today = dayKey(now);
  const timed: AgendaItem[] = [];
  const allDay: AgendaItem[] = [];
  const done: AgendaItem[] = [];

  for (const { task, path } of items) {
    if (isTerminal(task)) {
      if (task.completed && task.completed.slice(0, 10) === today) {
        done.push({ task, path, overdue: false });
      }
      continue;
    }
    if (!task.due || task.due.slice(0, 10) !== today) continue;
    const time = timeOf(task.due);
    if (time) timed.push({ task, path, time, overdue: isOverdue(task, now) });
    else allDay.push({ task, path, overdue: false });
  }

  timed.sort((a, b) => a.time!.localeCompare(b.time!) || byTitle(a, b));
  allDay.sort(byTitle);
  done.sort((a, b) => (b.task.completed ?? '').localeCompare(a.task.completed ?? '')); // latest first
  return { timed, allDay, done };
}

function byTitle(a: AgendaItem, b: AgendaItem): number {
  return a.task.title.localeCompare(b.task.title, 'zh');
}

// Which grid day a task occupies, and whether it's a grayed terminal chip. Non-terminal → due day;
// terminal → completed day; a task with no anchoring date never appears.
function landingDay(task: Task): { day: string; terminal: boolean } | null {
  if (isTerminal(task)) return task.completed ? { day: task.completed.slice(0, 10), terminal: true } : null;
  return task.due ? { day: task.due.slice(0, 10), terminal: false } : null;
}

// FR-036 月网格分桶: Monday-start, 5/6 rows (whole weeks covering the month + leading/trailing fill).
// `view` selects the visible month (any date within it). Chips are bucketed onto their landing day
// and only rendered when that day is inside the grid range.
export function monthGrid(view: Date, items: readonly DatedTask[], now: Date): CalCell[] {
  const y = view.getFullYear();
  const m = view.getMonth();
  const firstOffset = (new Date(y, m, 1).getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((firstOffset + daysInMonth) / 7);
  const cellCount = weeks * 7;
  const todayKey = dayKey(now);

  const byDay = new Map<string, CalChip[]>();
  for (const { task, path } of items) {
    const landing = landingDay(task);
    if (!landing) continue;
    const chip: CalChip = {
      task,
      path,
      cls: task.status,
      priority: priTag(task),
      time: landing.terminal || !task.due ? undefined : timeOf(task.due),
      terminal: landing.terminal,
    };
    const list = byDay.get(landing.day);
    if (list) list.push(chip);
    else byDay.set(landing.day, [chip]);
  }

  const cells: CalCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(y, m, 1 - firstOffset + i);
    const key = dayKey(date);
    const chips = (byDay.get(key) ?? []).slice().sort(chipSort);
    cells.push({ date, key, inMonth: date.getMonth() === m, isToday: key === todayKey, chips });
  }
  return cells;
}

// Same-day order: timed first (by time), then all-day, then title.
function chipSort(a: CalChip, b: CalChip): number {
  const ta = a.time ?? '99:99';
  const tb = b.time ?? '99:99';
  return ta.localeCompare(tb) || a.task.title.localeCompare(b.task.title, 'zh');
}
