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
import { TERMINAL_STATUSES, type Status, type Task } from '../model/types';
import { bucketOf, completedToday, type Bucket } from '../time/timeRules';
import { parseTaskFile } from '../util/frontmatter';

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

  constructor(
    private reader: VaultReader,
    private writer: LogWriter = noopWriter,
    private now: () => Date = () => new Date(),
  ) {}

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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
    await this.load(path);
    await this.reconcileBlocked();
    this.emit();
  }

  async remove(path: string): Promise<void> {
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
      for (const id of openNow) {
        if (this.blockedIds.has(id)) continue;
        const e = byId.get(id);
        if (e) await this.writer.appendLog(e.path, mkEdge(ts, e.task.status, 'blocked', '依赖未完成，自动阻塞'));
      }
      for (const id of this.blockedIds) {
        if (openNow.has(id)) continue;
        const e = byId.get(id);
        if (e) await this.writer.appendLog(e.path, mkEdge(ts, 'blocked', e.task.status, '依赖已完成，自动解除'));
      }
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
    // User request 2026-08-19: group-sort by project, then priority, then due.
    for (const k of Object.keys(view) as Bucket[]) view[k].sort(groupSortKey);
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

// Project→priority→due ordering (user request 2026-08-19): tasks cluster by project folder
// name (project field, repo/* tag, else _未分类 — mirrors taskPaths.projectFolder but stays
// dependency-free here), then p0 before p3, then earliest due first.
function groupSortKey(a: Entry, b: Entry): number {
  const pa = a.task.project ?? (a.task.tags ?? []).find((t) => t.startsWith('repo/'))?.slice(5) ?? '~';
  const pb = b.task.project ?? (b.task.tags ?? []).find((t) => t.startsWith('repo/'))?.slice(5) ?? '~';
  if (pa !== pb) return pa.localeCompare(pb, 'zh');
  const wa = PRIORITY_WEIGHT[a.task.priority ?? 'none'] ?? 9;
  const wb = PRIORITY_WEIGHT[b.task.priority ?? 'none'] ?? 9;
  if (wa !== wb) return wa - wb;
  return sortKey(a, b);
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, normal: 1, low: 2, none: 3 };

// Stable ordering within a bucket: by due (then created, then id) ascending.
function sortKey(a: Entry, b: Entry): number {
  const ka = a.task.due ?? a.task.created;
  const kb = b.task.due ?? b.task.created;
  return ka < kb ? -1 : ka > kb ? 1 : a.task.id.localeCompare(b.task.id);
}
