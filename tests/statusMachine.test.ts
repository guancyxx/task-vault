import { describe, expect, it } from 'vitest';
import { STATUSES, TERMINAL_STATUSES, type Status, type Task } from '../src/model/types';
import { TRANSITIONS, completeTransition, legalPathToDone, transition } from '../src/model/statusMachine';

const NOW = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32
const NOW_ISO = '2026-08-19T14:32';

function baseTask(status: Status, extra: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'demo',
    status,
    created: '2026-08-19T09:00',
    ...extra,
  };
}

describe('TRANSITIONS table (FR-003)', () => {
  it('matches the spec transition map', () => {
    expect(TRANSITIONS).toEqual({
      inbox: ['todo', 'cancelled'],
      todo: ['doing', 'cancelled'],
      doing: ['waiting', 'review', 'done', 'cancelled'],
      review: ['done', 'doing', 'cancelled'],
      waiting: ['todo', 'doing', 'cancelled'],
      blocked: ['waiting', 'cancelled'],
      done: [],
      cancelled: ['todo'],
    });
  });

  it('never allows transitioning INTO blocked (derived only, FR-004)', () => {
    for (const targets of Object.values(TRANSITIONS)) {
      expect(targets).not.toContain('blocked');
    }
  });
});

describe('review gate (FR-030)', () => {
  it('allows doing -> review', () => expect(() => transition(baseTask('doing'), 'review', 'cc', NOW)).not.toThrow());
  it('allows review -> done', () => expect(() => transition(baseTask('review'), 'done', 'user', NOW)).not.toThrow());
  it('rejects todo -> review', () => expect(() => transition(baseTask('todo'), 'review', 'cc', NOW)).toThrow());
  it('keeps review non-terminal', () => expect(TERMINAL_STATUSES).not.toContain('review'));
});

describe('transition() full 7x7 matrix (FR-003)', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const legal = TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
        const task = baseTask(from);
        if (legal) {
          const res = transition(task, to, 'user', NOW);
          expect(res.patch.status).toBe(to);
          expect(res.record).toEqual({ actor: 'user', from, to, at: NOW });
        } else {
          expect(() => transition(task, to, 'user', NOW)).toThrow();
        }
      });
    }
  }
});

describe('timestamp maintenance (FR-003)', () => {
  it('todo -> doing records started, not completed', () => {
    const res = transition(baseTask('todo'), 'doing', 'cc', NOW);
    expect(res.patch.started).toBe(NOW_ISO);
    expect(res.patch.completed).toBeUndefined();
  });

  it('doing -> done records completed, not started', () => {
    const res = transition(baseTask('doing', { started: '2026-08-19T10:00' }), 'done', 'user', NOW);
    expect(res.patch.completed).toBe(NOW_ISO);
    expect(res.patch.started).toBeUndefined();
  });

  it('doing -> cancelled records completed', () => {
    const res = transition(baseTask('doing'), 'cancelled', 'user', NOW);
    expect(res.patch.completed).toBe(NOW_ISO);
  });

  it('waiting -> doing does not clobber an existing started', () => {
    const res = transition(baseTask('waiting', { started: '2026-08-19T10:00' }), 'doing', 'user', NOW);
    expect(res.patch.started).toBeUndefined();
  });

  it('cancelled -> todo (reopen) clears completed', () => {
    const task = baseTask('cancelled', { completed: '2026-08-19T11:00' });
    const res = transition(task, 'todo', 'user', NOW);
    expect(res.patch.status).toBe('todo');
    expect('completed' in res.patch).toBe(true);
    expect(res.patch.completed).toBeUndefined();
  });

  it('does not mutate the input task (immutability)', () => {
    const task = baseTask('todo');
    transition(task, 'doing', 'user', NOW);
    expect(task.status).toBe('todo');
    expect(task.started).toBeUndefined();
  });
});

describe('legalPathToDone (FR-013 checkbox-complete)', () => {
  it('doing is one step from done', () => {
    expect(legalPathToDone('doing')).toEqual(['done']);
  });
  it('todo advances via doing', () => {
    expect(legalPathToDone('todo')).toEqual(['doing', 'done']);
  });
  it('waiting takes the shortest chain (via doing)', () => {
    expect(legalPathToDone('waiting')).toEqual(['doing', 'done']);
  });
  it('inbox walks the full happy path', () => {
    expect(legalPathToDone('inbox')).toEqual(['todo', 'doing', 'done']);
  });
  it('cancelled reopens and completes', () => {
    expect(legalPathToDone('cancelled')).toEqual(['todo', 'doing', 'done']);
  });
  it('every non-done state has a legal path, and each hop is a legal transition', () => {
    for (const from of STATUSES) {
      if (from === 'done') {
        expect(legalPathToDone(from)).toBeNull();
        continue;
      }
      const path = legalPathToDone(from);
      expect(path).not.toBeNull();
      let cur: Status = from;
      for (const to of path!) {
        expect(TRANSITIONS[cur]).toContain(to);
        cur = to;
      }
      expect(cur).toBe('done');
    }
  });
});

describe('completeTransition (FR-013)', () => {
  it('todo → net patch is done with both timestamps, single [todo→done] record', () => {
    const res = completeTransition(baseTask('todo'), 'user', NOW)!;
    expect(res.patch.status).toBe('done');
    expect(res.patch.started).toBe(NOW_ISO);
    expect(res.patch.completed).toBe(NOW_ISO);
    expect(res.record).toMatchObject({ from: 'todo', to: 'done', actor: 'user' });
  });

  it('doing → keeps existing started, records completed', () => {
    const res = completeTransition(baseTask('doing', { started: '2026-08-19T10:00' }), 'cc', NOW)!;
    expect(res.patch.status).toBe('done');
    expect(res.patch.completed).toBe(NOW_ISO);
    expect(res.record.from).toBe('doing');
  });

  it('already done → null', () => {
    expect(completeTransition(baseTask('done'), 'user', NOW)).toBeNull();
  });

  it('does not mutate the input task', () => {
    const task = baseTask('todo');
    completeTransition(task, 'user', NOW);
    expect(task.status).toBe('todo');
    expect(task.started).toBeUndefined();
  });
});
