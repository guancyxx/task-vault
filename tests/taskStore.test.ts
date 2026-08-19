import { beforeEach, describe, expect, it } from 'vitest';
import { TaskStore, type LogWriter, type VaultReader } from '../src/store/taskStore';
import { serializeTaskFile } from '../src/util/frontmatter';
import type { EntryInput } from '../src/log/executionLog';
import type { Status, Task } from '../src/model/types';

const NOW = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32 (Wed)

function file(t: Partial<Task> & { id: string; status?: Status }): string {
  return serializeTaskFile(
    { title: t.id, status: 'todo', created: '2026-08-19T09:00', ...t } as Task,
    '',
  );
}

// In-memory vault: path → raw file contents. Mutate then call the store's incremental hooks.
class MemVault implements VaultReader, LogWriter {
  files = new Map<string, string>();
  logCalls: Array<{ path: string; entry: EntryInput }> = [];
  set(path: string, raw: string): void {
    this.files.set(path, raw);
  }
  async listTaskFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async appendLog(path: string, entry: EntryInput): Promise<void> {
    this.logCalls.push({ path, entry });
  }
}

let vault: MemVault;
let store: TaskStore;

beforeEach(() => {
  vault = new MemVault();
  store = new TaskStore(vault, vault, () => NOW);
});

describe('scan + index (FR-007)', () => {
  it('indexes every parseable file, grouped by bucket', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', due: '2026-08-19' })); // today
    vault.set('03 Tasks/b.md', file({ id: 'b', due: '2026-08-18' })); // overdue
    vault.set('03 Tasks/c.md', file({ id: 'c', status: 'inbox' })); // no-due → week
    vault.set('03 Tasks/d.md', file({ id: 'd', status: 'done', due: '2026-08-01', completed: '2026-08-19T10:00' })); // 今日完成
    vault.set('03 Tasks/e.md', file({ id: 'e', due: '2026-08-25' })); // week
    vault.set('03 Tasks/f.md', file({ id: 'f', status: 'done', due: '2026-08-10', completed: '2026-08-10T09:00' })); // old done → dropped
    await store.scan();

    const g = store.bucketed(NOW);
    expect(g.today.map((e) => e.task.id)).toEqual(['a']);
    expect(g.overdue.map((e) => e.task.id)).toEqual(['b']);
    expect(g.week.map((e) => e.task.id)).toEqual(['c', 'e']);
    expect(g.done.map((e) => e.task.id)).toEqual(['d']);
  });
});

describe('corrupt file isolation', () => {
  it('skips a broken file, keeps the rest, records the error', async () => {
    vault.set('03 Tasks/ok.md', file({ id: 'ok', due: '2026-08-19' }));
    vault.set('03 Tasks/bad.md', '---\nstatus: nonsense\n---\nno id here');
    await store.scan();

    expect(store.allEntries().map((e) => e.task.id)).toEqual(['ok']);
    expect(store.errors()).toHaveLength(1);
    expect(store.errors()[0].path).toBe('03 Tasks/bad.md');
  });
});

describe('blocked derivation (FR-004)', () => {
  it('derives blocked when a dependency is non-terminal', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', due: '2026-08-19', 'blocked-by': ['b'] }));
    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'doing' }));
    await store.scan();

    expect(store.isBlocked('a')).toBe(true);
    expect(store.blockSources('a').map((t) => t.id)).toEqual(['b']);
    // A non-terminal dep at first scan is a silent baseline (no restart log spam).
    expect(vault.logCalls).toHaveLength(0);
  });

  it('treats a missing dependency as still blocking', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', due: '2026-08-19', 'blocked-by': ['ghost'] }));
    await store.scan();
    expect(store.isBlocked('a')).toBe(true);
  });

  it('auto-releases to the stored status and logs when deps go terminal', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', status: 'doing', due: '2026-08-19', 'blocked-by': ['b'] }));
    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'doing' }));
    await store.scan();
    expect(store.isBlocked('a')).toBe(true);

    // B completes → A releases back to its stored status (doing → doing).
    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'done', due: '2026-08-01' }));
    await store.upsert('03 Tasks/b.md');

    expect(store.isBlocked('a')).toBe(false);
    expect(store.effectiveStatus('a')).toBe('doing');
    const release = vault.logCalls.find((c) => c.path === '03 Tasks/a.md');
    expect(release).toBeDefined();
    expect(release!.entry.from).toBe('blocked');
    expect(release!.entry.to).toBe('doing');
  });

  it('logs an enter-blocked edge when a dep regresses after baseline', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', status: 'todo', due: '2026-08-19', 'blocked-by': ['b'] }));
    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'done', due: '2026-08-01' }));
    await store.scan();
    expect(store.isBlocked('a')).toBe(false);

    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'todo' }));
    await store.upsert('03 Tasks/b.md');

    expect(store.isBlocked('a')).toBe(true);
    const enter = vault.logCalls.find((c) => c.path === '03 Tasks/a.md');
    expect(enter!.entry.from).toBe('todo');
    expect(enter!.entry.to).toBe('blocked');
  });
});

describe('parent tree progress (FR-005)', () => {
  it('reports x/y done children', async () => {
    vault.set('03 Tasks/p.md', file({ id: 'p', status: 'doing' }));
    vault.set('03 Tasks/c1.md', file({ id: 'c1', status: 'done', parent: 'p', due: '2026-08-01' }));
    vault.set('03 Tasks/c2.md', file({ id: 'c2', status: 'cancelled', parent: 'p' }));
    vault.set('03 Tasks/c3.md', file({ id: 'c3', status: 'todo', parent: 'p' }));
    await store.scan();

    expect(store.children('p').map((e) => e.task.id)).toEqual(['c1', 'c2', 'c3']);
    expect(store.progress('p')).toEqual({ done: 2, total: 3 });
  });
});

describe('incremental update + change notification', () => {
  it('re-parses one file and fires listeners', async () => {
    vault.set('03 Tasks/a.md', file({ id: 'a', status: 'inbox' }));
    await store.scan();
    let fired = 0;
    store.onChange(() => (fired += 1));

    vault.set('03 Tasks/a.md', file({ id: 'a', due: '2026-08-19' }));
    await store.upsert('03 Tasks/a.md');
    expect(store.bucketed(NOW).today.map((e) => e.task.id)).toEqual(['a']);

    await store.remove('03 Tasks/a.md');
    expect(store.allEntries()).toHaveLength(0);
    expect(fired).toBe(2);
  });
});
