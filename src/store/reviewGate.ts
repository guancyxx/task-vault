// FR-030 external-write guard. UI actions carry an explicit user actor and bypass this module;
// TaskStore invokes it only while ingesting an incremental vault upsert.

import { recordEntry } from '../log/executionLog';
import { parseLogEntries } from '../model/agentProgress';
import { TERMINAL_STATUSES, type Status, type Task } from '../model/types';

export const REVIEW_GATE_TEXT = '复核门禁：拦截 agent 直接置 done，转待复核（FR-030）';
export const AUTO_ACTOR = 'hermes' as const;

const USER_ACTOR = /·\s*`user`/;
const TO_DONE = /\*\*[^*\n]*→done\*\*/;

export function hasUserDoneConfirmation(body: string): boolean {
  if (body.includes('Reminders 里勾了完成')) return true;
  const entries = parseLogEntries(body);
  const doneIndex = entries.findIndex((entry) => TO_DONE.test(entry.text));
  if (doneIndex < 0) return false;
  if (USER_ACTOR.test(entries[doneIndex].text)) return true;
  // Logs are newest-first. A smaller index is chronologically later than the done edge.
  return entries.slice(0, doneIndex).some((entry) => USER_ACTOR.test(entry.text));
}

export function shouldGuardExternalDone(previous: Status, task: Task, body: string): boolean {
  return (
    !TERMINAL_STATUSES.includes(previous) &&
    task.status === 'done' &&
    (task.assignee ?? '') !== 'user' &&
    !body.includes('复核门禁') &&
    !hasUserDoneConfirmation(body)
  );
}

export function applyReviewGate(task: Task, body: string, now: Date): { task: Task; body: string } {
  const guarded = { ...task, status: 'review' as const };
  delete guarded.completed;
  return {
    task: guarded,
    body: recordEntry(body, {
      ts: now,
      actor: AUTO_ACTOR,
      from: 'done',
      to: 'review',
      text: REVIEW_GATE_TEXT,
    }),
  };
}

export interface ReviewGateWriter {
  enforceReviewGate(path: string, previous: Status, now: Date): Promise<boolean>;
}
