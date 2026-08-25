import { beforeEach, describe, expect, it } from 'vitest';
import { groupSortKey, TaskStore, type Entry, type LogWriter, type VaultReader } from '../src/store/taskStore';
import { serializeTaskFile } from '../src/util/frontmatter';
import type { EntryInput } from '../src/log/executionLog';
import type { Status, Task } from '../src/model/types';
import { applyReviewGate, shouldGuardExternalDone, type ReviewGateWriter } from '../src/store/reviewGate';
import { parseTaskFile } from '../src/util/frontmatter';

const NOW = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32 (Wed)

function file(t: Partial<Task> & { id: string; status?: Status }): string {
  return serializeTaskFile(
    { title: t.id, status: 'todo', created: '2026-08-19T09:00', ...t } as Task,
    '',
  );
}

// In-memory vault: path → raw file contents. Mutate then call the store's incremental hooks.
class MemVault implements VaultReader, LogWriter, ReviewGateWriter {
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
  async enforceReviewGate(path: string, previous: Status, now: Date): Promise<boolean> {
    const parsed = parseTaskFile(await this.read(path), path);
    if (!parsed.ok || !shouldGuardExternalDone(previous, parsed.task, parsed.body)) return false;
    const guarded = applyReviewGate(parsed.task, parsed.body, now);
    this.set(path, serializeTaskFile(guarded.task, guarded.body));
    return true;
  }
}

let vault: MemVault;
let store: TaskStore;

beforeEach(() => {
  vault = new MemVault();
  store = new TaskStore(vault, vault, () => NOW, vault);
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
    expect(g.week.map((e) => e.task.id)).toEqual(['e', 'c']);
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
    vault.set('03 Tasks/b.md', file({ id: 'b', status: 'done', due: '2026-08-01', assignee: 'user' }));
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

describe('external done review gate (FR-030)', () => {
  const path = '03 Tasks/gated.md';
  const delegated = (status: Status, body = '', extra: Partial<Task> = {}): string =>
    serializeTaskFile(
      { id: 'gated', title: 'gated', status, created: '2026-08-19T09:00', assignee: 'cc', ...extra },
      body,
    );

  async function baselineThenDone(body = '', extra: Partial<Task> = {}): Promise<void> {
    vault.set(path, delegated('doing'));
    await store.scan();
    vault.set(path, delegated('done', body, { completed: '2026-08-19T14:30', ...extra }));
    await store.upsert(path);
  }

  it('rewrites an unconfirmed external done to review and clears completed', async () => {
    await baselineThenDone('## 执行记录\n- 2026-08-19 14:30 · **doing→done** · `cc`\n  完成\n');
    const entry = store.entryByPath(path)!;
    expect(entry.task.status).toBe('review');
    expect(entry.task.completed).toBeUndefined();
    expect(entry.body).toContain('**done→review** · `hermes`');
    expect(entry.body).toContain('复核门禁');
  });

  it('allows a Reminders completion marker', async () => {
    await baselineThenDone('## 执行记录\n- 2026-08-19 14:30 · `user`\n  Reminders 里勾了完成\n');
    expect(store.entryByPath(path)!.task.status).toBe('done');
  });

  it('allows a user-authored done transition', async () => {
    await baselineThenDone('## 执行记录\n- 2026-08-19 14:30 · **doing→done** · `user`\n  确认完成\n');
    expect(store.entryByPath(path)!.task.status).toBe('done');
  });

  it('does not duplicate intervention on a repeated event', async () => {
    await baselineThenDone('## 执行记录\n- 2026-08-19 14:30 · **doing→done** · `cc`\n  完成\n');
    await store.upsert(path);
    const matches = store.entryByPath(path)!.body.match(/复核门禁/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('groupSortKey execution ordering (FR-028/030)', () => {
  function entry(id: string, status: Status, body = '', extra: Partial<Task> = {}): Entry {
    return {
      path: `03 Tasks/${id}.md`,
      task: { id, title: id, status, created: '2026-08-19T09:00', project: 'same', ...extra },
      body,
    };
  }

  it('sorts review before doing within the same project', () => {
    const review = entry('review', 'review');
    const doing = entry('doing', 'doing');
    expect([doing, review].sort(groupSortKey).map((e) => e.task.id)).toEqual(['review', 'doing']);
  });

  it('sorts a stuck agent task before todo within the same project', () => {
    const stuck = entry('stuck', 'doing', '## 执行记录\n- 2026-08-19 12:00 · **卡点** · `cc`\n  卡点：等待权限\n', { assignee: 'cc' });
    const todo = entry('todo', 'todo');
    expect([todo, stuck].sort(groupSortKey).map((e) => e.task.id)).toEqual(['stuck', 'todo']);
  });

});

describe('groupSortKey full fallback chain (FR-028/030 audit debt)', () => {
  function entry(id: string, status: Status = 'todo', body = '', extra: Partial<Task> = {}): Entry {
    return {
      path: `03 Tasks/${id}.md`,
      task: { id, title: id, status, created: '2026-08-19T09:00', project: 'same', ...extra },
      body,
    };
  }

  const sortedIds = (entries: Entry[]): string[] => entries.sort(groupSortKey).map((e) => e.task.id);

  it('uses project before every later key', () => {
    const first = entry('first', 'inbox', '', { project: '甲', priority: 'low', due: '2026-08-30' });
    const second = entry('second', 'review', '', { project: '乙', priority: 'high', due: '2026-08-01' });
    expect(sortedIds([second, first])).toEqual(['first', 'second']);
  });

  it('uses execution status when project is equal', () => {
    const review = entry('review', 'review', '', { priority: 'low', due: '2026-08-30' });
    const todo = entry('todo', 'todo', '', { priority: 'high', due: '2026-08-01' });
    expect(sortedIds([todo, review])).toEqual(['review', 'todo']);
  });

  it('uses priority when project and status are equal', () => {
    const high = entry('high', 'todo', '', { priority: 'high', due: '2026-08-30' });
    const low = entry('low', 'todo', '', { priority: 'low', due: '2026-08-01' });
    expect(sortedIds([low, high])).toEqual(['high', 'low']);
  });

  it('uses due when project, status, and priority are equal', () => {
    const early = entry('early', 'todo', '', { due: '2026-08-20', created: '2026-08-19T10:00' });
    const late = entry('late', 'todo', '', { due: '2026-08-21', created: '2026-08-18T10:00' });
    expect(sortedIds([late, early])).toEqual(['early', 'late']);
  });

  it('uses created when both tasks have no due', () => {
    const early = entry('early-created', 'todo', '', { created: '2026-08-18T10:00' });
    const late = entry('late-created', 'todo', '', { created: '2026-08-19T10:00' });
    expect(sortedIds([late, early])).toEqual(['early-created', 'late-created']);
  });

  it('uses id when due and created are equal', () => {
    const a = entry('a', 'todo', '', { due: '2026-08-20', created: '2026-08-19T10:00' });
    const b = entry('b', 'todo', '', { due: '2026-08-20', created: '2026-08-19T10:00' });
    expect(sortedIds([b, a])).toEqual(['a', 'b']);
  });

  it('orders every execution weight, including working waiting and dispatched variants', () => {
    const accepted = '## 执行记录\n- 2026-08-20 11:00 · `cc`\n  接单：开始执行\n';
    const stuckBody =
      '## 执行记录\n- 2026-08-20 12:00 · **卡点** · `cc`\n  等待权限\n\n' +
      '- 2026-08-20 11:00 · `cc`\n  接单：开始执行\n';
    const entries = [
      entry('inbox', 'inbox'),
      entry('todo', 'todo'),
      entry('todo-dispatched', 'todo', '', { assignee: 'cc', dispatched: '2026-08-20T10:00' }),
      entry('doing-dispatched', 'doing', '', { assignee: 'cc', dispatched: '2026-08-20T10:00' }),
      entry('stuck', 'doing', stuckBody, { assignee: 'cc' }),
      entry('waiting-working', 'waiting', accepted, { assignee: 'cc' }),
      entry('doing', 'doing'),
      entry('review', 'review'),
    ];
    expect(sortedIds(entries)).toEqual([
      'review',
      'doing',
      'waiting-working',
      'stuck',
      'doing-dispatched',
      'todo-dispatched',
      'todo',
      'inbox',
    ]);
  });

  it('groups missing project/tags under ~ and derives repo tags without merging sources', () => {
    const named = entry('named', 'todo', '', { project: '!named' });
    const unnamedA = entry('unnamed-a', 'todo', '', { project: undefined, tags: undefined });
    const unnamedB = entry('unnamed-b', 'todo', '', { project: undefined, tags: [] });
    const repo = entry('repo', 'todo', '', { project: undefined, tags: ['other', 'repo/-repository'] });
    const explicit = entry('explicit', 'todo', '', { project: '!explicit', tags: undefined });

    expect(sortedIds([unnamedB, repo, explicit, unnamedA, named])).toEqual([
      'repo',
      'explicit',
      'named',
      'unnamed-a',
      'unnamed-b',
    ]);
  });

  it('keeps the done bucket chronological and excludes review', async () => {
    vault.set('03 Tasks/later.md', file({
      id: 'original-doing',
      status: 'done',
      due: '2026-08-20',
      completed: '2026-08-19T12:00',
      assignee: 'cc',
    }));
    vault.set('03 Tasks/earlier.md', file({
      id: 'original-inbox',
      status: 'done',
      due: '2026-08-18',
      completed: '2026-08-19T13:00',
    }));
    vault.set('03 Tasks/review.md', file({
      id: 'needs-review',
      status: 'review',
      due: '2026-08-17',
      assignee: 'cc',
    }));
    await store.scan();

    const buckets = store.bucketed(NOW);
    expect(buckets.done.map((e) => e.task.id)).toEqual(['original-inbox', 'original-doing']);
    expect(buckets.done.map((e) => e.task.id)).not.toContain('needs-review');
    expect(buckets.review.map((e) => e.task.id)).toEqual(['needs-review']);
  });
});

// Sidebar wikilink fix: frontmatter `project` may be written as a wikilink ("[[学习]]") or bare
// (学习) — the 规范 allows both. groupSortKey now derives its project key from
// taskPaths.projectFolder, so both spellings must land in the SAME project cluster (one divider,
// adjacent rows) instead of splitting into two groups.
describe('groupSortKey wikilink project stripping', () => {
  function entry(id: string, project: string | undefined): Entry {
    return {
      path: `03 Tasks/${id}.md`,
      task: { id, title: id, status: 'todo', created: '2026-08-19T09:00', project } as Task,
      body: '',
    };
  }

  it('treats "[[学习]]" and bare 学习 as the same project (comparator ties at 0)', () => {
    // Identical except the project spelling AND the id — the comparator keeps comparing after
    // the project key, so id must match too for a guaranteed tie at 0.
    const link = entry('same', '[[学习]]');
    const bare = entry('same', '学习');
    expect(groupSortKey(link, bare)).toBe(0);
    expect(groupSortKey(bare, link)).toBe(0);
  });

  it('sorts wikilink and bare spellings of one project adjacent, apart from other projects', () => {
    const mixed = [
      entry('z-bare', 'task-vault'),
      entry('other', '别的项目'),
      entry('a-link', '[[task-vault]]'),
    ];
    const ids = mixed.sort(groupSortKey).map((e) => e.task.id);
    expect(Math.abs(ids.indexOf('a-link') - ids.indexOf('z-bare'))).toBe(1);
    expect(ids.indexOf('other')).toBeGreaterThan(-1);
  });

  it('treats a missing project and an empty project as the same uncategorized cluster', () => {
    const noField = entry('same', undefined);
    const empty = entry('same', '');
    expect(groupSortKey(noField, empty)).toBe(0);
  });
});
