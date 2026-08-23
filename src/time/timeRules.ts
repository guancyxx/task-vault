// Time-rule engine (FR-006/007/008, SC-007). Pure functions, zero side effects.
// Buckets, countdown/overdue labels, and reminder-moment derivation from status+start+due.
// DDL never mutates status (FR-008) — these functions only *derive* display state.

import { TERMINAL_STATUSES, type Task } from '../model/types';

export type Bucket = 'review' | 'inbox' | 'today' | 'overdue' | 'week' | 'done';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isDateOnly(v: string): boolean {
  return !v.includes('T');
}

// Parse a local `YYYY-MM-DD[THH:MM]` into a Date built from local components (date-only → 00:00).
function parseLocal(v: string): Date {
  const [datePart, timePart] = v.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart ? timePart.split(':').map(Number) : [0, 0];
  return new Date(y, mo - 1, d, h, mi);
}

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function dayStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole-day difference between two `YYYY-MM-DD` strings, DST-safe via UTC epoch days.
function diffDays(later: string, earlier: string): number {
  const dayNum = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / DAY);
  };
  return dayNum(later) - dayNum(earlier);
}

function isTerminal(task: Task): boolean {
  return TERMINAL_STATUSES.includes(task.status);
}

// FR-007: 今天/过期/本周/今日完成 from status+start+due. Terminal → 今日完成 (only completed
// today is surfaced); overdue never contains done. Order: terminal → overdue → start-gated
// week → today → week. No-date tasks fall to 本周 (inbox bucket removed 2026-08-19).
export function bucketOf(task: Task, now: Date): Bucket {
  if (isTerminal(task)) return 'done';
  if (task.status === 'review') return 'review';
  const due = task.due;
  if (!due) return 'week';

  const nowDay = dayStr(now);
  if (isOverdue(task, now)) return 'overdue';

  // A start in the future means the task isn't actionable today (FR-006): push to 本周.
  if (task.start) {
    const startFuture = isDateOnly(task.start)
      ? task.start.slice(0, 10) > nowDay
      : parseLocal(task.start) > now;
    if (startFuture) return 'week';
  }

  if (due.slice(0, 10) === nowDay) return 'today';
  return 'week';
}

// A terminal task belongs in 今日完成 only when it completed today (older ones are archived
// nightly into 98 archive — see archive_daily.py).
export function completedToday(task: Task, now: Date): boolean {
  if (!task.completed) return false;
  return task.completed.slice(0, 10) === dayStr(now);
}

// FR-035 项目统计口径: 过期 = 非终态且 due < now. Date-only compares by day; timed by the minute.
// Note this ignores the review-before-due precedence in bucketOf — a project's overdue tally
// counts every non-terminal task past its due, review included.
export function isOverdue(task: Task, now: Date): boolean {
  if (isTerminal(task)) return false;
  const due = task.due;
  if (!due) return false;
  return isDateOnly(due) ? due.slice(0, 10) < dayStr(now) : parseLocal(due) < now;
}

// Monday-start local week window for the 本周完成 tally. Returns [start, nextStart).
function weekWindow(now: Date): [Date, Date] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (midnight.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const start = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - mondayOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return [start, end];
}

// FR-035 本周完成: completed timestamp falls in the current Monday..Sunday local week.
export function completedThisWeek(task: Task, now: Date): boolean {
  if (!task.completed) return false;
  const [start, end] = weekWindow(now);
  const at = parseLocal(task.completed);
  return at >= start && at < end;
}

// FR-008: timed countdown `剩 XhYm` and overdue `超期 Nd|Nh|Nm`. All-day non-overdue and terminal
// carry no badge (null). Amber/red styling is a view concern, not part of the label.
export function countdownLabel(task: Task, now: Date): string | null {
  if (isTerminal(task)) return null;
  const due = task.due;
  if (!due) return null;

  if (isDateOnly(due)) {
    const days = diffDays(dayStr(now), due.slice(0, 10));
    return days > 0 ? `超期 ${days}d` : null;
  }

  const ms = parseLocal(due).getTime() - now.getTime();
  if (ms < 0) return formatOverdue(-ms);
  if (ms >= DAY) return null; // countdown badge only within 24h
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  return h > 0 ? `剩 ${h}h${m}m` : `剩 ${m}m`;
}

function formatOverdue(ms: number): string {
  if (ms >= DAY) return `超期 ${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `超期 ${Math.floor(ms / HOUR)}h`;
  return `超期 ${Math.floor(ms / MINUTE)}m`;
}

function offsetMs(remind: string): number {
  const m = /^(\d+)([mhd])$/.exec(remind);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'm' ? n * MINUTE : m[2] === 'h' ? n * HOUR : n * DAY;
}

// FR-006: reminder moment. timed → due (or due−offset); all-day → default time (or default−offset).
// Returns local `YYYY-MM-DDTHH:MM`, or null when there is no due to anchor on.
export function remindMoment(task: Task, defaultAllday = '09:00'): string | null {
  const due = task.due;
  if (!due) return null;
  const base = isDateOnly(due) ? parseLocal(`${due.slice(0, 10)}T${defaultAllday}`) : parseLocal(due);
  const ms = task.remind ? offsetMs(task.remind) : 0;
  return formatLocal(new Date(base.getTime() - ms));
}
