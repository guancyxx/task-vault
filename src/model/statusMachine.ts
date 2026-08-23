// Eight-state machine + timestamp maintenance (FR-003, FR-030). Pure functions, no persistence.

import type { Actor, Status, Task } from './types';

// Legal transitions (spec Code Style). `blocked` appears in no target list: it is derived
// from blocked-by (FR-004), never set by hand, so transition() INTO blocked always throws.
// `review` (FR-030) is the agent delivery gate: doing → review hands the task to the user
// for confirmation; review only exits to done (approved), doing (rework) or cancelled.
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  inbox: ['todo', 'cancelled'],
  todo: ['doing', 'cancelled'],
  doing: ['waiting', 'review', 'done', 'cancelled'],
  review: ['done', 'doing', 'cancelled'], // gated completion: user confirms from here
  waiting: ['todo', 'doing', 'cancelled'],
  blocked: ['waiting', 'cancelled'], // exits only; entry is derived
  done: [],
  cancelled: ['todo'], // reopen
};

export interface TransitionRecord {
  actor: Actor;
  from: Status;
  to: Status;
  at: Date;
}

export interface TransitionResult {
  // Field patch to merge onto the task; `completed: undefined` means "clear this field".
  patch: Partial<Task>;
  // Migration record; the execution-log layer (Task 4) formats it into `[from→to]`.
  record: TransitionRecord;
}

const TERMINAL: readonly Status[] = ['done', 'cancelled'];
const AGENT_ACTORS: readonly Actor[] = ['hermes', 'cc', 'codex'];

function localIsoMinute(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isLegalTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

// Checkbox-complete (FR-013): the machine only allows done from doing, so completing a todo/inbox
// must traverse legal steps. BFS the shortest legal chain of states (excluding `from`) ending at
// done, or null if `from` is already done. Used to auto-advance a checked task through the machine.
export function legalPathToDone(from: Status): Status[] | null {
  if (from === 'done') return null;
  const queue: Array<{ at: Status; path: Status[] }> = [{ at: from, path: [] }];
  const seen = new Set<Status>([from]);
  while (queue.length > 0) {
    const { at, path } = queue.shift()!;
    for (const next of TRANSITIONS[at]) {
      if (next === 'done') return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ at: next, path: [...path, next] });
    }
  }
  return null; // unreachable from the current 8-state graph, but keep the guard honest
}

// Fold the whole legal chain from the task's status to done into ONE net result (FR-013): the
// merged field patch (status=done + started/completed maintained by each hop) plus a single
// `[from→done]` migration record — intermediate hops are legal but not logged as separate lines.
// Returns null if the task is already done.
export function completeTransition(task: Task, actor: Actor, now: Date): TransitionResult | null {
  const path = legalPathToDone(task.status);
  if (!path) return null;
  let working = task;
  let patch: Partial<Task> = {};
  for (const to of path) {
    const res = transition(working, to, actor, now);
    patch = { ...patch, ...res.patch };
    working = { ...working, ...res.patch };
  }
  return { patch, record: { actor, from: task.status, to: 'done', at: now } };
}

export function transition(task: Task, to: Status, actor: Actor, now: Date): TransitionResult {
  const from = task.status;
  // FR-030 hard gate: agents deliver into review; only an explicit user channel may
  // confirm any task as done. This also gates completeTransition(), which folds via here.
  if (to === 'done' && AGENT_ACTORS.includes(actor)) {
    throw new Error(`Illegal transition for agent actor ${actor}: ${from} -> done (use review)`);
  }
  if (!isLegalTransition(from, to)) {
    throw new Error(`Illegal transition: ${from} -> ${to}`);
  }

  const patch: Partial<Task> = { status: to };
  const stamp = localIsoMinute(now);

  // Entering doing for the first time records started; re-entry (waiting->doing) keeps it.
  if (to === 'doing' && !task.started) {
    patch.started = stamp;
  }

  // Entering a terminal state records completed.
  if (TERMINAL.includes(to)) {
    patch.completed = stamp;
  }

  // Reopen (cancelled->todo) clears the terminal completion timestamp.
  if (TERMINAL.includes(from) && !TERMINAL.includes(to)) {
    patch.completed = undefined;
  }

  return { patch, record: { actor, from, to, at: now } };
}
