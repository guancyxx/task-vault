import { describe, expect, it } from 'vitest';
// FR-050/051 integration seams: sidebar aggregation-zone judgement and the decision
// write-back through TaskActions (checkbox flip + ✅ date + kind=决策 log entry).
import { TaskActions } from '../src/store/taskActions';
import { createT } from '../src/i18n';
import { applyDecision, stampDate } from '../src/model/decisionPoints';
import { getSection } from '../src/util/frontmatter';
import { recordEntry } from '../src/log/executionLog';
import { decisionZoneEntries } from '../src/view/sidebarView';
import type { TaskStore, Entry } from '../src/store/taskStore';
import type { EntryInput } from '../src/log/executionLog';

const OPEN_BODY = ['## 决策点', '- [ ] D1 方案A', '- [ ] D1 方案B'].join('\n');
const SETTLED_BODY = ['## 决策点', '- [x] D1 方案A ✅ 2026-08-24'].join('\n');

function makeTask(over: Partial<Task2>): { task: Task2 } {
  return { task: { id: 't1', title: 'T', status: 'todo', created: '2026-08-20T09:00', ...over } };
}
type Task2 = Entry['task'];

function makeStore(entries: Array<{ path: string; task: Task2; body: string }>): Pick<TaskStore, 'allEntries'> {
  return {
    allEntries: () => entries.map((e) => ({ ...e, error: undefined }) as unknown as Entry),
  };
}

describe('decisionZoneEntries (FR-050 aggregation-zone judgement)', () => {
  it('lists non-terminal tasks with open groups, carrying distinct Dn prefixes', () => {
    const store = makeStore([
      { path: 'a.md', task: makeTask({ id: 'a' }).task, body: OPEN_BODY },
      { path: 'b.md', task: makeTask({ id: 'b' }).task, body: SETTLED_BODY },
      { path: 'c.md', task: makeTask({ id: 'c' }).task, body: 'no section' },
    ]);
    const pending = decisionZoneEntries(store);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ path: 'a.md', groups: ['D1'] });
    expect(pending[0].task.id).toBe('a');
  });

  it('terminal tasks never nag even with open options', () => {
    const store = makeStore([
      { path: 'done.md', task: makeTask({ id: 'd', status: 'done' }).task, body: OPEN_BODY },
    ]);
    expect(decisionZoneEntries(store)).toEqual([]);
  });

  it('collapses multiple options of one group to a single row, multiple groups to one list', () => {
    const body = ['## 决策点', '- [ ] D1 甲', '- [ ] D1 乙', '- [ ] D2 丙'].join('\n');
    const store = makeStore([{ path: 'a.md', task: makeTask({ id: 'a' }).task, body }]);
    const [row] = decisionZoneEntries(store);
    expect(row.groups).toEqual(['D1', 'D2']);
  });

  it('sorts most urgent first: due, then created, then id', () => {
    const store = makeStore([
      { path: 'late.md', task: makeTask({ id: 'z', created: '2026-08-22T09:00' }).task, body: OPEN_BODY },
      { path: 'soon.md', task: makeTask({ id: 'm', due: '2026-08-21', created: '2026-08-19T09:00' }).task, body: OPEN_BODY },
      { path: 'early.md', task: makeTask({ id: 'a', created: '2026-08-18T09:00' }).task, body: OPEN_BODY },
    ]);
    expect(decisionZoneEntries(store).map((p) => p.path)).toEqual(['early.md', 'soon.md', 'late.md']);
  });
});

// Write-back seam: an in-memory file stands in for the vault — modifyBody applies the
// transform the way VaultSource does, appendLog renders the entry through recordEntry.
// The assertions then run against the exact string sequence the real writer commits.
describe('TaskActions.resolveDecision (FR-050 write-back)', () => {
  const NOW = new Date(2026, 7, 25, 10, 30);

  function makeActions(body: string): { actions: TaskActions; file: () => string; entry: () => EntryInput | undefined } {
    let file = `---\nid: t1\n---\n${body}`;
    let logged: EntryInput | undefined;
    const bodyWriter = {
      modifyBody: async (_path: string, transform: (b: string) => string | null) => {
        const fence = /^---\n[\s\S]*?\n---\n?/.exec(file);
        const prefix = fence ? fence[0] : '';
        const b = fence ? file.slice(fence[0].length) : file;
        const next = transform(b);
        if (next === null) return false;
        file = prefix + next;
        return true;
      },
      appendLog: async (_path: string, entry: EntryInput) => {
        logged = entry;
        const fence = /^---\n[\s\S]*?\n---\n?/.exec(file);
        const prefix = fence ? fence[0] : '';
        const b = fence ? file.slice(fence[0].length) : file;
        file = prefix + recordEntry(b, entry);
      },
      upsertSection: async () => {},
    };
    const store = { entryByPath: () => null, isBlocked: () => false } as unknown as TaskStore;
    const actions = new TaskActions({} as never, store, bodyWriter as never, {} as never, 'user', () => NOW, () => createT('en'));
    return { actions, file: () => file, entry: () => logged };
  }

  it('checks the option line, stamps ✅ date, and appends a kind=决策 actor=user log entry', async () => {
    const body = ['## 任务', 'work', '', '## 决策点', '- [ ] D1 甲方案', '- [ ] D1 乙方案', '', '## 执行记录', '- 2026-08-24 09:00 · `user`', '  旧记录'].join('\n');
    const { actions, file, entry } = makeActions(body);
    const ok = await actions.resolveDecision('a.md', 'D1', '乙方案');
    expect(ok).toBe(true);

    const out = file();
    const lines = out.split('\n');
    const idx = lines.indexOf('- [x] D1 乙方案 ✅ 2026-08-25');
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx - 1]).toBe('- [ ] D1 甲方案'); // sibling untouched
    // Frontmatter fence and the settled old log entry stay byte-identical.
    expect(lines[0]).toBe('---');
    expect(out).toContain('- 2026-08-24 09:00 · `user`');

    expect(entry()).toMatchObject({
      actor: 'user',
      kind: '决策',
      text: 'D1 乙方案',
      ts: NOW,
    });
    // The rendered 执行记录 section carries the new kind=决策 entry, newest first.
    const fenceEnd = out.split('\n').indexOf('---', 1) + 1;
    const rendered = getSection(out.split('\n').slice(fenceEnd).join('\n'), '## 执行记录') ?? '';
    expect(rendered.indexOf('**决策**')).toBeGreaterThan(-1);
    expect(rendered).toContain('D1 乙方案');
    expect(rendered.indexOf('D1 乙方案')).toBeLessThan(rendered.indexOf('旧记录')); // newest first
  });

  it('returns false and logs nothing when the line already drifted (already checked)', async () => {
    const { actions, file, entry } = makeActions(SETTLED_BODY);
    const ok = await actions.resolveDecision('a.md', 'D1', '方案A');
    expect(ok).toBe(false);
    expect(file()).toBe(`---\nid: t1\n---\n${SETTLED_BODY}`); // byte-identical — no write
    expect(entry()).toBeUndefined();
  });
});

// Belt-and-braces: the transform handed to modifyBody is exactly applyDecision + stampDate.
describe('resolveDecision transform contract', () => {
  it('the pure seam composes: applyDecision(body, group, label, stampDate(now))', () => {
    const body = OPEN_BODY;
    const out = applyDecision(body, 'D1', '方案A', stampDate(new Date(2026, 7, 25)));
    expect(out).toBe(['## 决策点', '- [x] D1 方案A ✅ 2026-08-25', '- [ ] D1 方案B'].join('\n'));
  });
});
