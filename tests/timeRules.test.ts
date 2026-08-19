import { describe, expect, it } from 'vitest';
import type { Bucket } from '../src/time/timeRules';
import { bucketOf, countdownLabel, remindMoment } from '../src/time/timeRules';
import type { Status, Task } from '../src/model/types';

const NOW = new Date(2026, 7, 19, 14, 32); // local 2026-08-19 14:32 (Wed)

function task(extra: Partial<Task> & { status?: Status } = {}): Task {
  return { id: 'id-1', title: 't', status: 'todo', created: '2026-08-19T09:00', ...extra };
}

// ---------- bucketOf (FR-007) ----------

const BUCKETS: Array<[string, Task, Bucket]> = [
  ['terminal done → done', task({ status: 'done', due: '2026-08-19' }), 'done'],
  ['terminal cancelled → done', task({ status: 'cancelled' }), 'done'],
  ['done with past due never overdue', task({ status: 'done', due: '2026-08-01' }), 'done'],
  ['no due + inbox → week (inbox bucket removed)', task({ status: 'inbox' }), 'week'],
  ['no due + todo → week (inbox bucket removed)', task({ status: 'todo' }), 'week'],
  ['date-only today → today', task({ due: '2026-08-19' }), 'today'],
  ['date-only yesterday → overdue', task({ due: '2026-08-18' }), 'overdue'],
  ['date-only tomorrow → week', task({ due: '2026-08-20' }), 'week'],
  ['date-only 3 days out → week', task({ due: '2026-08-22' }), 'week'],
  ['date-only next month → week', task({ due: '2026-09-15' }), 'week'],
  ['datetime today 23:59 → today', task({ due: '2026-08-19T23:59' }), 'today'],
  ['datetime today future 15:00 → today', task({ due: '2026-08-19T15:00' }), 'today'],
  ['datetime today past 14:00 → overdue', task({ due: '2026-08-19T14:00' }), 'overdue'],
  ['datetime tomorrow → week', task({ due: '2026-08-20T09:00' }), 'week'],
  ['datetime yesterday → overdue', task({ due: '2026-08-18T14:32' }), 'overdue'],
  ['start tomorrow gates out of today → week', task({ start: '2026-08-20', due: '2026-08-19' }), 'week'],
  ['start today keeps today', task({ start: '2026-08-19', due: '2026-08-19' }), 'today'],
  ['start future datetime gates future-due → week', task({ start: '2026-08-20T08:00', due: '2026-08-19T18:00' }), 'week'],
  ['blocked status still bucketed by due (tomorrow)', task({ status: 'blocked', due: '2026-08-20' }), 'week'],
  ['waiting status today', task({ status: 'waiting', due: '2026-08-19' }), 'today'],
];

describe('bucketOf (FR-007)', () => {
  for (const [name, t, expected] of BUCKETS) {
    it(name, () => expect(bucketOf(t, NOW)).toBe(expected));
  }
});

// ---------- countdownLabel (FR-008, SC-007) ----------

const COUNTDOWNS: Array<[string, Task, string | null]> = [
  ['3h12m ahead', task({ due: '2026-08-19T17:44' }), '剩 3h12m'],
  ['exactly 1h', task({ due: '2026-08-19T15:32' }), '剩 1h0m'],
  ['under 1h drops hours', task({ due: '2026-08-19T15:02' }), '剩 30m'],
  ['overdue minutes', task({ due: '2026-08-19T14:00' }), '超期 32m'],
  ['overdue hours', task({ due: '2026-08-19T11:32' }), '超期 3h'],
  ['overdue 1 day (datetime)', task({ due: '2026-08-18T14:32' }), '超期 1d'],
  ['overdue 2 days (datetime)', task({ due: '2026-08-17T14:32' }), '超期 2d'],
  ['>24h ahead → no badge', task({ due: '2026-08-21T09:00' }), null],
  ['date-only overdue 1d', task({ due: '2026-08-18' }), '超期 1d'],
  ['date-only overdue 2d', task({ due: '2026-08-17' }), '超期 2d'],
  ['date-only today → no badge', task({ due: '2026-08-19' }), null],
  ['date-only tomorrow → no badge', task({ due: '2026-08-20' }), null],
  ['done → no badge', task({ status: 'done', due: '2026-08-18T14:32' }), null],
  ['no due → no badge', task({}), null],
];

describe('countdownLabel (FR-008, SC-007)', () => {
  for (const [name, t, expected] of COUNTDOWNS) {
    it(name, () => expect(countdownLabel(t, NOW)).toBe(expected));
  }
});

// ---------- remindMoment (FR-006) ----------

const REMINDS: Array<[string, Task, string | null]> = [
  ['datetime due, no offset → due', task({ due: '2026-08-20T14:00' }), '2026-08-20T14:00'],
  ['datetime due − 30m', task({ due: '2026-08-20T14:00', remind: '30m' }), '2026-08-20T13:30'],
  ['datetime due − 2h', task({ due: '2026-08-20T14:00', remind: '2h' }), '2026-08-20T12:00'],
  ['datetime due − 1d', task({ due: '2026-08-20T14:00', remind: '1d' }), '2026-08-19T14:00'],
  ['date-only default 09:00', task({ due: '2026-08-25' }), '2026-08-25T09:00'],
  ['date-only default − 30m', task({ due: '2026-08-25', remind: '30m' }), '2026-08-25T08:30'],
  ['date-only default − 1d', task({ due: '2026-08-25', remind: '1d' }), '2026-08-24T09:00'],
  ['no due → null', task({}), null],
];

describe('remindMoment (FR-006)', () => {
  for (const [name, t, expected] of REMINDS) {
    it(name, () => expect(remindMoment(t)).toBe(expected));
  }
  it('honors a custom all-day default time', () => {
    expect(remindMoment(task({ due: '2026-08-25' }), '08:00')).toBe('2026-08-25T08:00');
  });
});

// ---------- purity (no side effects) ----------

describe('pure functions — no side effects (SC-007)', () => {
  it('never mutates the input task', () => {
    const original = task({ due: '2026-08-19T17:44', start: '2026-08-19', remind: '30m' });
    const snapshot = JSON.parse(JSON.stringify(original));
    const frozen = Object.freeze({ ...original });
    bucketOf(frozen, NOW);
    countdownLabel(frozen, NOW);
    remindMoment(frozen);
    expect(original).toEqual(snapshot);
  });
});
