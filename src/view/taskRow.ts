// Task row rendering + inline interaction (FR-011, FR-013). Layout: pinned left rail
// (fold + completion checkbox) + fluid column — line 1: tag chips (priority p0-p3 first),
// then the full multi-line title, then the right-aligned dates row. Status glyph removed
// (2026-08-19): status reads from the left color rail; changes via the right-click popover.
// Left click opens the task document; right click (contextmenu) opens the detail popover.

import { STATUSES, TERMINAL_STATUSES, type Status, type Task } from '../model/types';
import type { AgentPhase } from '../model/agentProgress';
import { TRANSITIONS } from '../model/statusMachine';
import { countdownLabel } from '../time/timeRules';
import { createT, type MessageKey, type T } from '../i18n';

interface StatusMeta {
  glyph: string;
  cls: string;
}

// Delegation marker (FR-015/016): shown when a task is assigned to someone other than self.
export const DELEGATE_GLYPH = '➤';

// status → dictionary key (labels live in the i18n dicts, FR-039).
const STATUS_KEY: Record<Status, MessageKey> = {
  inbox: 'status.inbox',
  todo: 'status.todo',
  doing: 'status.doing',
  review: 'status.review',
  waiting: 'status.waiting',
  blocked: 'status.blocked',
  done: 'status.done',
  cancelled: 'status.cancelled',
};

// Default (zh) translator: the pure helpers below fall back to it when no `t` is injected, so the
// unit tests keep seeing Chinese labels and STATUS_LABEL stays the single zh source (no drift).
const ZH: T = createT('zh-CN');

// Localized status label. `t` defaults to zh so pure callers/tests keep Chinese; the UI passes
// its active translator. Shared with the legend / detail popover / commands so labels never drift.
export function statusLabel(status: Status, t: T = ZH): string {
  return t(STATUS_KEY[status]);
}

// Human labels for each status (menu items, legend), derived from the zh dict — same values as
// before, now sourced from i18n so the dictionary is the one place they live.
export const STATUS_LABEL: Record<Status, string> = Object.fromEntries(
  STATUSES.map((s) => [s, ZH(STATUS_KEY[s])]),
) as Record<Status, string>;

// Legend seed: status × glyph × color-class (color lives in styles.css via `tv-status-<cls>`).
export const STATUS_META: Record<Status, StatusMeta> = {
  inbox: { glyph: '○', cls: 'inbox' },
  todo: { glyph: '◻', cls: 'todo' },
  doing: { glyph: '◐', cls: 'doing' },
  review: { glyph: '👁', cls: 'review' },
  waiting: { glyph: '⏳', cls: 'waiting' },
  blocked: { glyph: '⛔', cls: 'blocked' },
  done: { glyph: '✓', cls: 'done' },
  cancelled: { glyph: '✕', cls: 'cancelled' },
};

// Row tooltip (FR-031): the color rail is the primary status channel, so the row carries
// a title so hovering names the state. Pure — the single source for the tooltip wording.
// `t` defaults to zh so existing callers/tests get Chinese; the UI passes its active translator.
export function statusTooltip(status: Status, t: T = ZH): string {
  return t('row.statusTooltip', { label: statusLabel(status, t), status });
}

// Legal transition targets for a status, decorated with the label/glyph/color-class a target
// button renders (FR-032 设置状态 command; also mirrors the detail popover's status buttons).
// Empty for a state with no legal exits. Pure so it's unit-testable without the obsidian shim.
export interface StatusTarget {
  to: Status;
  label: string;
  glyph: string;
  cls: string;
}

export function statusTargets(status: Status, t: T = ZH): StatusTarget[] {
  return TRANSITIONS[status].map((to) => ({
    to,
    label: statusLabel(to, t),
    glyph: STATUS_META[to].glyph,
    cls: STATUS_META[to].cls,
  }));
}

// Priority → tag label (user request 2026-08-19: show priority as p0-p3 tags).
export const PRIORITY_TAG: Record<string, string> = {
  high: 'p0',
  normal: 'p1',
  low: 'p2',
};
export const P3_TAG = 'p3'; // no priority set

// Inline actions the row triggers. The sidebar view supplies concrete handlers (TaskActions +
// popovers). Absent (read-only) rows simply render without listeners.
export interface RowActions {
  complete(task: Task): void;
  reschedule(task: Task): void;
  openDetail(task: Task, evt: MouseEvent): void;
  openDoc(task: Task, path: string): void;
}

// Parent-row affordance: fold toggle + x/y progress (FR-005/013).
export interface RowChild {
  count: number;
  done: number;
  collapsed: boolean;
  onToggle(): void;
}

export interface RowContext {
  // Effective status = blocked overlay if dependencies are open, else the stored status.
  effectiveStatus: Status;
  blockSources: Task[]; // non-empty → render blocked/grayed with a source tooltip
  now: Date;
  path: string;
  actions?: RowActions;
  child?: RowChild; // present when the task has sub-tasks
  indent?: boolean; // this row is itself a sub-task rendered under its parent
  agentPhase?: { phase: AgentPhase; lastActivity?: string };
  t: T; // active translator, injected by the view (FR-039)
}

function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function renderTaskRow(parent: HTMLElement, task: Task, ctx: RowContext): HTMLElement {
  const t = ctx.t;
  const meta = STATUS_META[ctx.effectiveStatus];
  const blocked = ctx.blockSources.length > 0;
  const row = parent.createDiv({
    cls: ['tv-row', `tv-status-${meta.cls}`],
    attr: { title: statusTooltip(ctx.effectiveStatus, t) },
  });
  row.toggleClass('tv-blocked', blocked);
  row.toggleClass('tv-waiting', ctx.effectiveStatus === 'waiting');
  row.toggleClass('tv-child', ctx.indent === true);
  const a = ctx.actions;

  // Left click → open the task document (user request 2026-08-19).
  if (a) row.addEventListener('click', () => a.openDoc(task, ctx.path));
  // Right click → detail popover (quick props / quick fill / delegate / status menu).
  if (a) {
    row.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      a.openDetail(task, evt);
    });
  }

  // Left rail: fold toggle + completion checkbox.
  const rail = row.createDiv({ cls: 'tv-rail' });

  if (ctx.child) {
    const fold = rail.createSpan({ cls: 'tv-fold', text: ctx.child.collapsed ? '▸' : '▾' });
    fold.addEventListener('click', (evt) => {
      evt.stopPropagation();
      ctx.child!.onToggle();
    });
  }

  const box = rail.createEl('input', { cls: 'tv-check', attr: { type: 'checkbox', title: t('row.check') } });
  box.checked = ctx.effectiveStatus === 'done';
  box.disabled = !a || isTerminal(ctx.effectiveStatus) || blocked;
  box.addEventListener('click', (evt) => evt.stopPropagation());
  box.addEventListener('change', () => {
    if (box.checked) a?.complete(task);
  });

  // Column order (user request 2026-08-19): tags → title → dates(right-aligned).
  const col = row.createDiv({ cls: 'tv-col' });

  // Row 1 (top): tags — priority (p0-p3) first, then free/repo/project/area/delegate chips.
  const tags = col.createDiv({ cls: 'tv-tags' });
  const pt = task.priority ? PRIORITY_TAG[task.priority] : undefined;
  tags.createSpan({ cls: `tv-tag tv-pri tv-pri-${pt ?? P3_TAG}`, text: pt ?? P3_TAG });
  for (const t of task.tags ?? []) {
    if (t.startsWith('repo/')) {
      tags.createSpan({ cls: 'tv-tag tv-tag-repo', text: t.slice('repo/'.length) });
    } else {
      tags.createSpan({ cls: 'tv-tag', text: `#${t}` });
    }
  }
  if (task.project) {
    tags.createSpan({ cls: 'tv-tag tv-tag-project', text: stripLink(task.project) });
  }
  if (task.area) {
    tags.createSpan({ cls: 'tv-tag tv-tag-area', text: stripLink(task.area) });
  }
  if (task.assignee && task.assignee !== 'user') {
    tags.createSpan({ cls: 'tv-tag tv-delegate', text: `${DELEGATE_GLYPH} ${task.assignee}` });
  }
  if (ctx.agentPhase) {
    const { phase, lastActivity } = ctx.agentPhase;
    let text = t(AGENT_PHASE_KEY[phase]);
    let stale = false;
    if (phase === 'working' && lastActivity) {
      const hours = Math.max(0, Math.floor((ctx.now.getTime() - parseLogTime(lastActivity).getTime()) / 3_600_000));
      text += ` ·${hours}h`;
      stale = hours > 4;
    }
    const chip = tags.createSpan({ cls: `tv-tag tv-agentphase-${phase}`, text });
    chip.toggleClass('tv-stale', stale);
  }
  if (ctx.effectiveStatus === 'waiting') {
    tags.createSpan({ cls: 'tv-tag tv-tag-waiting', text: t('row.waiting') });
  }
  if (blocked) {
    const names = ctx.blockSources.map((s) => s.title).join('、');
    tags.createSpan({ cls: 'tv-tag tv-block-src', text: t('row.blocked'), attr: { title: t('row.blockSource', { names }) } });
  }

  // Row 2: full multi-line title.
  col.createSpan({ cls: 'tv-title', text: task.title });

  // Row 3 (bottom, right-aligned): dates — due/countdown chip, start, sub-task progress.
  const dates = col.createDiv({ cls: 'tv-dates' });
  const badge = countdownLabel(task, ctx.now);
  let chip: HTMLElement | null = null;
  if (badge) {
    const overdue = badge.startsWith('超期');
    chip = dates.createSpan({ cls: ['tv-badge', overdue ? 'tv-overdue' : 'tv-countdown'], text: badge });
  } else if (task.due) {
    chip = dates.createSpan({ cls: ['tv-badge', 'tv-date'], text: dueChip(task.due) });
  }
  if (chip && a) {
    chip.addEventListener('click', (evt) => {
      evt.stopPropagation();
      a.reschedule(task);
    });
  }
  if (task.start) {
    dates.createSpan({ cls: 'tv-badge tv-start', text: `🛫 ${dueChip(task.start)}` });
  }
  if (ctx.child) {
    dates.createSpan({ cls: 'tv-progress', text: `${ctx.child.done}/${ctx.child.count}` });
  }
  return row;
}

const AGENT_PHASE_KEY: Record<AgentPhase, MessageKey> = {
  dispatched: 'agent.dispatched',
  working: 'agent.working',
  stuck: 'agent.stuck',
  review: 'agent.review',
};

function parseLogTime(value: string): Date {
  const [date, time] = value.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function stripLink(v: string): string {
  const m = /^\[\[(.+)\]\]$/.exec(v.trim());
  return m ? m[1] : v;
}

// Compact due label for the plain date chip: `MM-DD` for all-day, `MM-DD HH:MM` for timed.
function dueChip(due: string): string {
  const [d, t] = due.split('T');
  const md = d.slice(5);
  return t ? `${md} ${t}` : md;
}
