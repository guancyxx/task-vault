import { describe, expect, it } from 'vitest';
import { projectStats } from '../src/model/projectStats';
import type { Status, Task } from '../src/model/types';

// Local Wed 2026-08-19 14:32 → this week is Mon 2026-08-17 .. Sun 2026-08-23 (next Mon 08-24).
const NOW = new Date(2026, 7, 19, 14, 32);

function task(t: Partial<Task> & { id: string }): Task {
  return {
    title: t.id,
    status: (t.status ?? 'todo') as Status,
    created: '2026-08-01T09:00',
    ...t,
  } as Task;
}

describe('projectStats (FR-035)', () => {
  it('returns [] for an empty vault', () => {
    expect(projectStats([], NOW)).toEqual([]);
  });

  it('counts the five open states and excludes terminal from open', () => {
    const tasks = [
      task({ id: 'a', project: 'alpha', status: 'inbox' }),
      task({ id: 'b', project: 'alpha', status: 'todo' }),
      task({ id: 'c', project: 'alpha', status: 'doing' }),
      task({ id: 'd', project: 'alpha', status: 'review' }),
      task({ id: 'e', project: 'alpha', status: 'waiting' }),
      task({ id: 'f', project: 'alpha', status: 'done', completed: '2026-08-19T10:00' }),
      task({ id: 'g', project: 'alpha', status: 'cancelled', completed: '2026-08-19T10:00' }),
    ];
    const [alpha] = projectStats(tasks, NOW);
    expect(alpha.project).toBe('alpha');
    expect(alpha.open).toBe(5);
    expect(alpha.total).toBe(7);
  });

  it('counts 本周完成 on the Monday..Sunday boundary only', () => {
    const tasks = [
      task({ id: 'lastSun', project: 'p', status: 'done', completed: '2026-08-16T23:59' }), // prev week
      task({ id: 'thisMon', project: 'p', status: 'done', completed: '2026-08-17T00:00' }), // in week
      task({ id: 'today', project: 'p', status: 'done', completed: '2026-08-19T10:00' }), // in week
      task({ id: 'nextMon', project: 'p', status: 'done', completed: '2026-08-24T00:00' }), // next week
    ];
    const [p] = projectStats(tasks, NOW);
    expect(p.weekDone).toBe(2);
  });

  it('counts in-flight agents: assignee≠user and non-terminal', () => {
    const tasks = [
      task({ id: 'a', project: 'p', status: 'doing', assignee: 'cc' }), // in flight
      task({ id: 'b', project: 'p', status: 'review', assignee: 'codex' }), // in flight
      task({ id: 'c', project: 'p', status: 'done', assignee: 'cc', completed: '2026-08-19T10:00' }), // done → not
      task({ id: 'd', project: 'p', status: 'doing', assignee: 'user' }), // self → not
      task({ id: 'e', project: 'p', status: 'doing' }), // no assignee → not
    ];
    const [p] = projectStats(tasks, NOW);
    expect(p.agents).toBe(2);
  });

  it('counts overdue as non-terminal past due (review included, terminal/future excluded)', () => {
    const tasks = [
      task({ id: 'a', project: 'p', status: 'todo', due: '2026-08-18' }), // date-only overdue
      task({ id: 'b', project: 'p', status: 'doing', due: '2026-08-19T14:00' }), // timed overdue (14:00 < 14:32)
      task({ id: 'c', project: 'p', status: 'review', due: '2026-08-10' }), // overdue review still counts
      task({ id: 'd', project: 'p', status: 'todo', due: '2026-08-19T15:00' }), // later today → not
      task({ id: 'e', project: 'p', status: 'todo', due: '2026-08-25' }), // future → not
      task({ id: 'f', project: 'p', status: 'done', due: '2026-08-01', completed: '2026-08-19T10:00' }), // terminal → not
    ];
    const [p] = projectStats(tasks, NOW);
    expect(p.overdue).toBe(3);
  });

  it('groups by project identity and sorts by open desc (repo tag / uncategorized resolve)', () => {
    const tasks = [
      task({ id: 'a1', project: 'alpha', status: 'todo' }),
      task({ id: 'b1', tags: ['repo/beta'], status: 'todo' }), // repo/* → beta
      task({ id: 'b2', tags: ['repo/beta'], status: 'doing' }),
      task({ id: 'b3', tags: ['repo/beta'], status: 'inbox' }),
      task({ id: 'u1', status: 'todo' }), // no project/tag → _未分类
    ];
    const stats = projectStats(tasks, NOW);
    // beta leads on open=3; alpha & _未分类 tie at open=1, broken alphabetically ('_' < 'a').
    expect(stats.map((s) => s.project)).toEqual(['beta', '_未分类', 'alpha']);
    expect(stats[0].open).toBe(3);
  });

  it('merges case variants into one stat and keeps first-seen display spelling (08-25)', () => {
    const tasks = [
      task({ id: 'a1', project: 'Edu-Agent', status: 'todo' }),
      task({ id: 'a2', project: 'edu-agent', status: 'doing' }),
      task({ id: 'a3', project: '[[EDU-AGENT]]', status: 'inbox' }),
    ];
    const stats = projectStats(tasks, NOW);
    expect(stats).toHaveLength(1);
    expect(stats[0].project).toBe('edu-agent'); // folded identity
    expect(stats[0].display).toBe('Edu-Agent'); // first-seen original spelling
    expect(stats[0].open).toBe(3);
  });
});
