// FR-030 external-write guard. UI actions carry an explicit user actor and bypass this module;
// TaskStore invokes it only while ingesting an incremental vault upsert.
//
// User-confirmation channels — any ONE allows an external done write to stand:
//  1. `user` actor entry at/after the done edge (plugin UI; Reminders sync writes a user-authored edge)
//  2. Reminders completion marker text in the log
//  3. Chat-confirmation citation (FR-030a): a `user-confirm: session=<sid> msg=<id> quote="…"`
//     line in the done entry or a chronologically-later entry. The agent writes it after the user
//     confirmed in chat (e.g. 「做」). The plugin trusts the FORMAT only; the Python audit
//     (scripts/review_audit.py) verifies each citation against the Hermes session store —
//     a fabricated or hallucinated citation alerts there. Trust but verify, 12h cadence.

import { recordEntry } from '../log/executionLog';
import { parseLogEntries } from '../model/agentProgress';
import { TERMINAL_STATUSES, type Status, type Task } from '../model/types';

export const REVIEW_GATE_TEXT = '复核门禁：拦截 agent 直接置 done，转待复核（FR-030）';
export const AUTO_ACTOR = 'hermes' as const;

const USER_ACTOR = /·\s*`user`/;
const TO_DONE = /\*\*[^*\n]*→done\*\*/;
const USER_CONFIRM = /user-confirm:\s*session=([\w.-]+)\s+msg=(\d+)\s+quote="([^"\n]+)"/;

export function hasUserDoneConfirmation(body: string): boolean {
  if (body.includes('Reminders 里勾了完成')) return true;
  const entries = parseLogEntries(body);
  const doneIndex = entries.findIndex((entry) => TO_DONE.test(entry.text));
  if (doneIndex < 0) return false;
  // Logs are newest-first. The done entry itself and smaller indices are chronologically
  // at/after the done edge — a user action or citation there counts as confirmation.
  const atOrAfterDone = [entries[doneIndex], ...entries.slice(0, doneIndex)];
  if (atOrAfterDone.some((entry) => USER_ACTOR.test(entry.text))) return true;
  return atOrAfterDone.some((entry) => USER_CONFIRM.test(entry.text));
}

export function shouldGuardExternalDone(previous: Status, task: Task, body: string): boolean {
  return (
    !TERMINAL_STATUSES.includes(previous) &&
    task.status === 'done' &&
    (task.assignee ?? '') !== 'user' &&
    // Already-gated loop guard: match the gate's own marker line, not any mention of 复核门禁 —
    // an agent note merely quoting the gate must not disarm it.
    !body.includes(REVIEW_GATE_TEXT) &&
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
