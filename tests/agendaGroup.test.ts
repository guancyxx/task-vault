import { describe, expect, it } from 'vitest';
import { monthGrid, todayAgenda, type DatedTask } from '../src/model/agendaGroup';
import type { Status, Task } from '../src/model/types';

// Local Wed 2026-08-19 14:32.
const NOW = new Date(2026, 7, 19, 14, 32);

function task(t: Partial<Task> & { id: string }): Task {
  return {
    title: t.id,
    status: (t.status ?? 'todo') as Status,
    created: '2026-08-01T09:00',
    ...t,
  } as Task;
}

function dt(t: Partial<Task> & { id: string }): DatedTask {
  const full = task(t);
  return { task: full, path: `Tasks/${full.id}.md` };
}

describe('todayAgenda (FR-036)', () => {
  it('empty vault → all groups empty', () => {
    expect(todayAgenda([], NOW)).toEqual({ timed: [], allDay: [], done: [] });
  });

  it('timed sorted by time asc, all-day after, both due today', () => {
    const a = todayAgenda(
      [
        dt({ id: 'noon', due: '2026-08-19T12:00' }),
        dt({ id: 'allday', due: '2026-08-19' }),
        dt({ id: 'morning', due: '2026-08-19T09:00' }),
      ],
      NOW,
    );
    expect(a.timed.map((i) => i.task.id)).toEqual(['morning', 'noon']);
    expect(a.allDay.map((i) => i.task.id)).toEqual(['allday']);
  });

  it('flags a timed item earlier than now as overdue, later one not', () => {
    const a = todayAgenda(
      [
        dt({ id: 'past', due: '2026-08-19T09:00' }),
        dt({ id: 'future', due: '2026-08-19T18:00' }),
      ],
      NOW,
    );
    const past = a.timed.find((i) => i.task.id === 'past')!;
    const future = a.timed.find((i) => i.task.id === 'future')!;
    expect(past.overdue).toBe(true);
    expect(future.overdue).toBe(false);
  });

  it('all-day due today is never overdue', () => {
    const a = todayAgenda([dt({ id: 'x', due: '2026-08-19' })], NOW);
    expect(a.allDay[0].overdue).toBe(false);
  });

  it('excludes tasks not due today, and terminal tasks from timed/allDay', () => {
    const a = todayAgenda(
      [
        dt({ id: 'tomorrow', due: '2026-08-20T10:00' }),
        dt({ id: 'nodate' }),
        dt({ id: 'doneToday', status: 'done', due: '2026-08-19T10:00', completed: '2026-08-19T11:00' }),
      ],
      NOW,
    );
    expect(a.timed).toEqual([]);
    expect(a.allDay).toEqual([]);
    expect(a.done.map((i) => i.task.id)).toEqual(['doneToday']);
  });

  it('done group = done/cancelled completed today, latest first; older excluded', () => {
    const a = todayAgenda(
      [
        dt({ id: 'early', status: 'done', completed: '2026-08-19T08:00' }),
        dt({ id: 'late', status: 'cancelled', completed: '2026-08-19T16:00' }),
        dt({ id: 'yesterday', status: 'done', completed: '2026-08-18T20:00' }),
      ],
      NOW,
    );
    expect(a.done.map((i) => i.task.id)).toEqual(['late', 'early']);
  });

  it('midnight boundary: due today 23:59 belongs to today; next-day 00:01 does not', () => {
    const a = todayAgenda(
      [
        dt({ id: 'lastMinute', due: '2026-08-19T23:59' }),
        dt({ id: 'nextDay', due: '2026-08-20T00:01' }),
      ],
      NOW,
    );
    expect(a.timed.map((i) => i.task.id)).toEqual(['lastMinute']); // 23:59 still today, still ahead of 14:32
    expect(a.timed[0].overdue).toBe(false);
  });
});

describe('monthGrid (FR-036)', () => {
  it('Monday-start whole weeks; Aug 2026 (1st = Sat) → 6 rows, first cell is the prior Monday', () => {
    const cells = monthGrid(new Date(2026, 7, 15), [], NOW);
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBe(42); // Aug 2026 spans 6 Monday-start weeks
    // First cell is Mon 2026-07-27 (Monday on/before Sat Aug 1).
    expect(cells[0].key).toBe('2026-07-27');
    expect(cells[0].date.getDay()).toBe(1); // Monday
    expect(cells[0].inMonth).toBe(false);
  });

  it('flags today and marks in/out-of-month cells', () => {
    const cells = monthGrid(NOW, [], NOW);
    const today = cells.find((c) => c.key === '2026-08-19')!;
    expect(today.isToday).toBe(true);
    expect(today.inMonth).toBe(true);
    expect(cells.filter((c) => c.inMonth).length).toBe(31); // August has 31 days
  });

  it('non-terminal task lands on its due day; terminal on its completed day and is grayed', () => {
    const cells = monthGrid(
      NOW,
      [
        dt({ id: 'open', due: '2026-08-10T09:00' }),
        dt({ id: 'closed', status: 'done', due: '2026-08-05', completed: '2026-08-12T15:00' }),
      ],
      NOW,
    );
    const d10 = cells.find((c) => c.key === '2026-08-10')!;
    const d12 = cells.find((c) => c.key === '2026-08-12')!;
    const d5 = cells.find((c) => c.key === '2026-08-05')!;
    expect(d10.chips.map((c) => c.task.id)).toEqual(['open']);
    expect(d10.chips[0].terminal).toBe(false);
    expect(d12.chips.map((c) => c.task.id)).toEqual(['closed']); // placed by completed, not due
    expect(d12.chips[0].terminal).toBe(true);
    expect(d5.chips).toEqual([]); // its due date carries nothing
  });

  it('month-end task in the trailing next-month filler days appears', () => {
    // Sep 2026: 1st = Tue → grid starts Mon 08-31, trailing days into early Oct.
    const cells = monthGrid(new Date(2026, 8, 15), [dt({ id: 'oct1', due: '2026-10-01' })], NOW);
    const oct1 = cells.find((c) => c.key === '2026-10-01');
    expect(oct1?.chips.map((c) => c.task.id)).toEqual(['oct1']);
    expect(oct1?.inMonth).toBe(false);
  });

  it('a task outside the visible grid range is not placed anywhere', () => {
    const cells = monthGrid(NOW, [dt({ id: 'faraway', due: '2026-12-25' })], NOW);
    expect(cells.some((c) => c.chips.length > 0)).toBe(false);
  });

  it('month whose 1st is Sunday (Feb 2026) → Monday-start needs 6 leading filler cells; 5 rows', () => {
    const cells = monthGrid(new Date(2026, 1, 15), [], NOW); // Feb 2026: 1st = Sun, 28 days
    expect(cells.length).toBe(35); // 6 leading + 28 = 34 → ceil/7 = 5 rows
    for (let i = 0; i < 6; i++) expect(cells[i].inMonth).toBe(false); // 6 prior-month filler days
    expect(cells[6].key).toBe('2026-02-01'); // the 1st lands in the 7th (Sunday) column
    expect(cells[6].inMonth).toBe(true);
    expect(cells[0].date.getDay()).toBe(1); // grid still starts on a Monday
  });

  it('4-row month: 28-day Feb starting Monday (2021-02) → exactly 28 cells, no filler', () => {
    const cells = monthGrid(new Date(2021, 1, 10), [], NOW);
    expect(cells.length).toBe(28); // firstOffset 0 + 28 days → 4 rows, zero leading/trailing filler
    expect(cells.every((c) => c.inMonth)).toBe(true);
    expect(cells[0].key).toBe('2021-02-01');
  });

  it('terminal task missing completed → falls back to due day, NOT grayed (legacy rows keep their cell)', () => {
    const cells = monthGrid(
      NOW,
      [dt({ id: 'legacyDone', status: 'done', due: '2026-08-14T10:00' })], // no completed field
      NOW,
    );
    const d14 = cells.find((c) => c.key === '2026-08-14')!;
    expect(d14.chips.map((c) => c.task.id)).toEqual(['legacyDone']);
    expect(d14.chips[0].terminal).toBe(false); // fallback is not grayed
    expect(d14.chips[0].time).toBe('10:00'); // timed due survives the fallback
  });

  it('terminal task with neither completed nor due is dropped (no anchoring date)', () => {
    const cells = monthGrid(NOW, [dt({ id: 'orphan', status: 'cancelled' })], NOW);
    expect(cells.some((c) => c.chips.length > 0)).toBe(false);
  });

  it('empty in-month days render an empty chip list', () => {
    const cells = monthGrid(NOW, [dt({ id: 'only10', due: '2026-08-10' })], NOW);
    const d11 = cells.find((c) => c.key === '2026-08-11')!;
    expect(d11.inMonth).toBe(true);
    expect(d11.chips).toEqual([]); // a task-free in-month day is empty, not undefined
  });

  it('same-day chips ordered timed (by time) → all-day → title; carry priority + status class', () => {
    const cells = monthGrid(
      NOW,
      [
        dt({ id: 'zeta-allday', due: '2026-08-10', priority: 'low', status: 'doing' }),
        dt({ id: 'alpha-allday', due: '2026-08-10', priority: 'high' }),
        dt({ id: 'pm', due: '2026-08-10T14:00' }),
        dt({ id: 'am', due: '2026-08-10T08:00' }),
      ],
      NOW,
    );
    const d10 = cells.find((c) => c.key === '2026-08-10')!;
    expect(d10.chips.map((c) => c.task.id)).toEqual(['am', 'pm', 'alpha-allday', 'zeta-allday']);
    const zeta = d10.chips.find((c) => c.task.id === 'zeta-allday')!;
    expect(zeta.priority).toBe('p2'); // low → p2
    expect(zeta.cls).toBe('doing');
    expect(d10.chips.find((c) => c.task.id === 'alpha-allday')!.priority).toBe('p0'); // high → p0
  });
});
