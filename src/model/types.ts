// Task Vault data model — single source of truth for the frontmatter schema (FR-001).

export type Status =
  | 'inbox'
  | 'todo'
  | 'doing'
  | 'review'
  | 'waiting'
  | 'blocked'
  | 'done'
  | 'cancelled';

// Canonical order; used by tests and any UI that enumerates states.
export const STATUSES: readonly Status[] = [
  'inbox',
  'todo',
  'doing',
  'review',
  'waiting',
  'blocked',
  'done',
  'cancelled',
];

// Terminal states never re-fire hooks and never leave via transition() except reopen.
export const TERMINAL_STATUSES: readonly Status[] = ['done', 'cancelled'];

// Execution-log actors (contract §7).
export type Actor = 'hermes' | 'cc' | 'codex' | 'user';
export const ACTORS: readonly Actor[] = ['hermes', 'cc', 'codex', 'user'];

// Capture syntax `!high` etc. (FR-010).
export type Priority = 'high' | 'normal' | 'low';

// Where the task came from. Known values below; kept open for future channels.
export type Source = 'user' | 'siri' | 'hermes' | 'cc' | 'codex' | 'migration' | (string & {});

// Sync-owned mirror block (FR-024). Only the Reminders sync script reads/writes this.
export interface Mirror {
  'reminders-uuid': string;
}

// A task = its frontmatter fields (FR-001). Body sections (## 执行记录 / ## 委派) are
// handled separately by the frontmatter IO layer (Task 3); they are not part of this model.
export interface Task {
  id: string; // UUID; immutable identity (FR-002)
  title: string;
  status: Status;
  start?: string; // YYYY-MM-DD | YYYY-MM-DDTHH:MM — planned start
  due?: string; // YYYY-MM-DD (all-day) | YYYY-MM-DDTHH:MM (hard deadline)
  remind?: string; // offset before due, e.g. "30m" | "2h" | "1d"
  created: string; // YYYY-MM-DDTHH:MM (local)
  started?: string; // set on first entry into doing
  completed?: string; // set on entry into a terminal state; cleared on reopen
  priority?: Priority;
  source?: Source;
  assignee?: string; // actor or agent name; user = self
  dispatched?: string; // YYYY-MM-DDTHH:MM — delegation timestamp
  session?: string; // resumable agent session id (FR-048) — hook/ops maintained (like
  // `dispatched`), the plugin UI reads but never writes it; empty = cold start
  project?: string;
  area?: string;
  parent?: string; // parent task id (FR-005)
  'blocked-by'?: string[]; // ids of dependency tasks (FR-004)
  tags?: string[];
  mirror?: Mirror;
}

// Frontmatter key order for serialization (Task 3 reads this as the single source).
export const FRONTMATTER_KEYS: readonly (keyof Task)[] = [
  'id',
  'title',
  'status',
  'start',
  'due',
  'remind',
  'created',
  'started',
  'completed',
  'priority',
  'source',
  'assignee',
  'dispatched',
  'project',
  'area',
  'parent',
  'blocked-by',
  'tags',
  'mirror',
];
