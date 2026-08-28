// Task index (FR-004/005/007). Pure, injectable core — no obsidian import, unit-testable with
// an in-memory VaultReader/LogWriter. The obsidian wiring (vault.on + debounce) lives in the
// thin adapter src/store/vaultSource.ts, keeping this module framework-free.
//
// `blocked` is derived as an OVERLAY: the file's stored status is never rewritten to `blocked`
// (FR-004 「不可手设」). Effective status = has-open-dep ? 'blocked' : stored — so releasing a
// dependency returns a task to its stored status (doing→doing, todo→todo) for free. Enter/release
// edges are logged by diffing against the prior snapshot; the first scan seeds a silent baseline
// so a restart with still-open deps does not re-log.

import type { EntryInput } from '../log/executionLog';
import { agentProgress } from '../model/agentProgress';
import { TERMINAL_STATUSES, type Status, type Task } from '../model/types';
import { bucketOf, completedToday, type Bucket } from '../time/timeRules';
import { parseTaskFile } from '../util/frontmatter';
import { shouldGuardExternalDone, type ReviewGateWriter } from './reviewGate';
import { projectKey, UNCATEGORIZED } from './taskPaths';

export interface Entry {
  path: string;
  task: Task;
  body: string;
}

export interface StoreError {
  path: string;
  error: string;
}

export interface VaultReader {
  listTaskFiles(): Promise<string[]>;
  read(path: string): Promise<string>;
}

export interface LogWriter {
  appendLog(path: string, entry: EntryInput): Promise<void>;
}

export type BucketedView = Record<Bucket, Entry[]>;

const noopWriter: LogWriter = { async appendLog() {} };

// FR-030b: default debounce re-read delay. Configurable 5–15s via config.review_debounce_seconds;
// clamped here so a bad config can never stretch the window absurdly.
export const DEFAULT_REVALIDATE_MS = 8_000;
const MIN_REVALIDATE_MS = 5_000;
const MAX_REVALIDATE_MS = 15_000;

export function clampRevalidateMs(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_REVALIDATE_MS;
  return Math.min(MAX_REVALIDATE_MS, Math.max(MIN_REVALIDATE_MS, seconds * 1_000));
}

// The automation actor for derived blocked-edge records (contract §7 actor set).
const AUTO_ACTOR = 'hermes' as const;

function isTerminal(status: Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class TaskStore {
  private byPath = new Map<string, Entry>();
  private errorsByPath = new Map<string, string>();
  private blockedIds = new Set<string>(); // last-reconciled overlay-blocked ids
  private baselined = false; // first reconcile seeds silently, no edge logs
  private listeners = new Set<() => void>();
  // FR-030b: pending debounce revalidations. Audit R2 (2026-08-28): keyed by task ID (not
  // path) so a rename inside the window migrates for free — the timer resolves the id to
  // whatever path the entry lives at when it fires, and a deleted task simply no-ops.
  private revalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private reader: VaultReader,
    private writer: LogWriter = noopWriter,
    private now: () => Date = () => new Date(),
    private reviewGate?: ReviewGateWriter,
    private revalidateDelayMs: () => number = () => DEFAULT_REVALIDATE_MS,
  ) {}

  // FR-030b: drop pending debounce timers + bar in-flight revalidates (plugin onunload).
  // Audit R3 (2026-08-28): dispose must stop not-yet-fired timers AND anything already
  // awaiting a vault write — the generation counter makes late continuations no-op.
  private disposed = false;
  private revalidateGeneration = 0;

  dispose(): void {
    this.disposed = true;
    this.revalidateGeneration++;
    for (const t of this.revalidateTimers.values()) clearTimeout(t);
    this.revalidateTimers.clear();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // Force a re-render of all subscribers without a data change (FR-039: language switch).
  notify(): void {
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  async scan(): Promise<void> {
    this.byPath.clear();
    this.errorsByPath.clear();
    for (const path of await this.reader.listTaskFiles()) await this.load(path);
    await this.reconcileBlocked();
    this.emit();
  }

  async upsert(path: string): Promise<void> {
    const previous = this.byPath.get(path);
    await this.load(path);
    const fresh = this.byPath.get(path);
    if (
      previous &&
      fresh &&
      shouldGuardExternalDone(previous.task.status, fresh.task, fresh.body) &&
      (await this.reviewGate?.enforceReviewGate(path, previous.task.status, this.now()))
    ) {
      await this.load(path);
      this.scheduleRevalidate(path);
    }
    await this.reconcileBlocked();
    this.emit();
  }

  // FR-030b debounce: N seconds after a bounce, re-read once. Confirmation landed → restore
  // done + release entry; not landed → the file stays in review, nothing written. The disk
  // marker is the idempotency anchor; this timer is best-effort and safe to lose (a missed
  // release just leaves the task in review for the human queue — same as pre-FR-030b).
  private scheduleRevalidate(path: string): void {
    if (!this.reviewGate) return;
    const id = this.byPath.get(path)?.task.id;
    if (id === undefined) return;
    const existing = this.revalidateTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.revalidateTimers.delete(id);
      // Resolve the id to its CURRENT path — survives a rename inside the window (audit R2);
      // a deleted/archived task resolves to nothing and the debounce dies harmlessly.
      const entry = this.entryById(id);
      if (entry) void this.revalidate(entry.path);
    }, this.revalidateDelayMs());
    this.revalidateTimers.set(id, timer);
  }

  private async revalidate(path: string): Promise<void> {
    const generation = this.revalidateGeneration;
    try {
      await this.reviewGate?.revalidateReviewGate(path, this.now());
    } catch {
      // File deleted/renamed mid-window or vault hiccup: swallow — losing the retry leaves
      // the task in review, which is the pre-FR-030b steady state, never corruption.
      return;
    }
    if (this.disposed || generation !== this.revalidateGeneration) return;
    // Re-review R3: a dedicated generation-aware refresh, NOT upsert — upsert's internal
    // awaits have no checkpoints, and its gate branch must not re-run off a timer anyway.
    await this.load(path);
    if (this.disposed || generation !== this.revalidateGeneration) return;
    await this.reconcileBlocked();
    if (this.disposed || generation !== this.revalidateGeneration) return;
    this.emit();
  }

  async remove(path: string): Promise<void> {
    // Audit R2 (2026-08-28): no timer cleanup needed here — revalidate timers are keyed by
    // task id and self-resolve at fire time (deleted task → entryById misses → no-op;
    // renamed task → fires against the new path). Deleting the entry below is all it takes.
    this.byPath.delete(path);
    this.errorsByPath.delete(path);
    await this.reconcileBlocked();
    this.emit();
  }

  // Corrupt-file isolation: a parse failure is recorded and the file dropped from the index,
  // never thrown — one bad file must not sink the whole library.
  private async load(path: string): Promise<void> {
    let raw: string;
    try {
      raw = await this.reader.read(path);
    } catch (e) {
      this.byPath.delete(path);
      this.errorsByPath.set(path, String(e));
      return;
    }
    const res = parseTaskFile(raw, path);
    if (res.ok) {
      this.byPath.set(path, { path, task: res.task, body: res.body });
      this.errorsByPath.delete(path);
    } else {
      this.byPath.delete(path);
      this.errorsByPath.set(path, res.error);
    }
  }

  private async reconcileBlocked(): Promise<void> {
    const byId = new Map<string, Entry>();
    for (const e of this.byPath.values()) byId.set(e.task.id, e);

    const openNow = new Set<string>();
    for (const e of this.byPath.values()) {
      const deps = e.task['blocked-by'];
      if (!deps || deps.length === 0) continue;
      // ponytail: a missing dep id counts as blocking — we can't confirm it terminal.
      const blocked = deps.some((id) => {
        const dep = byId.get(id);
        return !dep || !isTerminal(dep.task.status);
      });
      if (blocked) openNow.add(e.task.id);
    }

    if (this.baselined) {
      const ts = this.now();
      const generation = this.revalidateGeneration;
      // Third-audit R3: the cancel check is INSIDE the loop — a dispose landing while one
      // appendLog is pending must stop the remaining writes, not just the outer callers.
      const cancelled = (): boolean => this.disposed || generation !== this.revalidateGeneration;
      for (const id of openNow) {
        if (this.blockedIds.has(id) || cancelled()) continue;
        const e = byId.get(id);
        if (e) await this.writer.appendLog(e.path, mkEdge(ts, e.task.status, 'blocked', '依赖未完成，自动阻塞'));
      }
      for (const id of this.blockedIds) {
        if (openNow.has(id) || cancelled()) continue;
        const e = byId.get(id);
        if (e) await this.writer.appendLog(e.path, mkEdge(ts, 'blocked', e.task.status, '依赖已完成，自动解除'));
      }
      if (cancelled()) return; // leave blockedIds/baselined untouched for the next live pass
    }
    this.blockedIds = openNow;
    this.baselined = true;
  }

  // ---------- queries ----------

  allEntries(): Entry[] {
    return [...this.byPath.values()];
  }

  entryByPath(path: string): Entry | undefined {
    return this.byPath.get(path);
  }

  hasId(id: string): boolean {
    return this.entryById(id) !== undefined;
  }

  // UUID lookup for the local API (byPath is the path index; this is the id index).
  byId(id: string): Entry | undefined {
    return this.entryById(id);
  }

  errors(): StoreError[] {
    return [...this.errorsByPath.entries()].map(([path, error]) => ({ path, error }));
  }

  isBlocked(id: string): boolean {
    return this.blockedIds.has(id);
  }

  effectiveStatus(id: string): Status | undefined {
    const e = this.entryById(id);
    if (!e) return undefined;
    return this.blockedIds.has(id) ? 'blocked' : e.task.status;
  }

  // Open (non-terminal / missing) dependency tasks, for the blocked-source tooltip.
  blockSources(id: string): Task[] {
    const e = this.entryById(id);
    const deps = e?.task['blocked-by'];
    if (!deps) return [];
    const out: Task[] = [];
    for (const depId of deps) {
      const dep = this.entryById(depId);
      if (!dep || !isTerminal(dep.task.status)) {
        if (dep) out.push(dep.task);
      }
    }
    return out;
  }

  children(parentId: string): Entry[] {
    return this.allEntries()
      .filter((e) => e.task.parent === parentId)
      .sort((a, b) => a.task.id.localeCompare(b.task.id));
  }

  progress(parentId: string): { done: number; total: number } {
    const kids = this.children(parentId);
    return { done: kids.filter((e) => isTerminal(e.task.status)).length, total: kids.length };
  }

  bucketed(now: Date): BucketedView {
    const view: BucketedView = { review: [], inbox: [], today: [], overdue: [], week: [], done: [] };
    for (const e of this.byPath.values()) {
      const b = bucketOf(e.task, now);
      if (b === 'done' && !completedToday(e.task, now)) continue; // 今日完成 only
      view[b].push(e);
    }
    // Active buckets: project, execution state, priority, due. The done bucket keeps its
    // original chronological ordering; status/agent phase no longer matters once terminal.
    for (const k of Object.keys(view) as Bucket[]) view[k].sort(k === 'done' ? sortKey : groupSortKey);
    return view;
  }

  private entryById(id: string): Entry | undefined {
    for (const e of this.byPath.values()) if (e.task.id === id) return e;
    return undefined;
  }
}

function mkEdge(ts: Date, from: Status, to: Status, text: string): EntryInput {
  return { ts, actor: AUTO_ACTOR, from, to, text };
}

// Project→status/agent phase→priority→due ordering: tasks cluster by project folder name via
// taskPaths.projectFolder (wikilink "[[x]]" stripped, repo/* tag, else _未分类 — 1:1 with the
// disk folder), then p0 before p3, then earliest due first.
export function groupSortKey(a: Entry, b: Entry): number {
  // Design intent (FR-028 audit debt): the uncategorized cluster sorts LAST. Audit 08-25: never
  // rely on punctuation collation ('~' sorts BEFORE digits/CJK/alpha under ICU 'zh') — branch
  // explicitly on UNCATEGORIZED instead. Identity uses the case-folded projectKey (2026-08-25)
  // so casing variants of one project cluster together.
  const k = (e: Entry) => projectKey(e.task);
  const pa = k(a);
  const pb = k(b);
  if (pa === UNCATEGORIZED && pb === UNCATEGORIZED) {
    // same cluster — fall through to the tie-breakers below
  } else if (pa === UNCATEGORIZED) return 1;
  else if (pb === UNCATEGORIZED) return -1;
  if (pa !== pb) return pa.localeCompare(pb, 'zh');
  const sa = statusWeight(a);
  const sb = statusWeight(b);
  if (sa !== sb) return sa - sb;
  const wa = PRIORITY_WEIGHT[a.task.priority ?? 'none'] ?? 9;
  const wb = PRIORITY_WEIGHT[b.task.priority ?? 'none'] ?? 9;
  if (wa !== wb) return wa - wb;
  return sortKey(a, b);
}

export function statusWeight(entry: Entry): number {
  const phase = agentProgress(entry.task, entry.body)?.phase;
  if (phase === 'stuck') return 2.5;
  if (phase === 'dispatched') return 3;
  return STATUS_WEIGHT[entry.task.status] ?? 6;
}

const STATUS_WEIGHT: Partial<Record<Status, number>> = {
  review: 0,
  doing: 1,
  waiting: 2,
  todo: 4,
  inbox: 5,
};

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, normal: 1, low: 2, none: 3 };

// Stable ordering within a bucket: by due (then created, then id) ascending.
function sortKey(a: Entry, b: Entry): number {
  const ka = a.task.due ?? a.task.created;
  const kb = b.task.due ?? b.task.created;
  return ka < kb ? -1 : ka > kb ? 1 : a.task.id.localeCompare(b.task.id);
}
