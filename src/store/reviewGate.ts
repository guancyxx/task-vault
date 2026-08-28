// FR-030 external-write guard. UI actions carry an explicit user actor and bypass this module;
// TaskStore invokes it only while ingesting an incremental vault upsert.
//
// User-confirmation channels — any ONE, judged strictly inside the at-or-after-done window,
// allows an external done write to stand (aligned with scripts/review_audit.py — do not drift):
//  1. `user` actor in a canonical entry headline (plugin UI; Reminders sync) — a `· \`user\``
//     string inside a continuation line is prose, not an actor
//  2. Reminders completion marker text in the entry
//  3. Chat-confirmation citation (FR-030a): a `user-confirm: session=<sid> msg=<id> quote="…"`
//     line in the done entry or a chronologically-later entry. quote escapes: \" → ", \\ → \
//     (backslash-anything else is taken literally); empty quotes do not match. The agent writes
//     it after the user confirmed in chat (e.g. 「做」). The plugin trusts the FORMAT only; the
//     Python audit verifies each citation against the Hermes session store — a fabricated or
//     hallucinated citation alerts there. Trust but verify, 12h cadence.

import { recordEntry } from '../log/executionLog';
import { parseLogEntries } from '../model/agentProgress';
import { TERMINAL_STATUSES, type Status, type Task } from '../model/types';

export const REVIEW_GATE_TEXT = '复核门禁：拦截 agent 直接置 done，转待复核（FR-030）';
export const AUTO_ACTOR = 'hermes' as const;

const USER_ACTOR = /·\s*`user`/;
const TO_DONE = /\*\*[^*\n]*→done\*\*/;
// FR-030a citation — full-line syntax, anchored (audit R1 closure): the citation must be a
// standalone line; prefix/trailing junk on the same line is rejected on both sides.
// Escaped-quote grammar: [^"\\\n] or backslash-escaped any-char, at least one.
// Empty quote ("") intentionally does not match — it would substring-match anything.
const USER_CONFIRM = /^[ \t]*user-confirm:\s*session=([\w.-]+)\s+msg=(\d+)\s+quote="((?:[^"\\\n]|\\.)+)"[ \t]*$/m;
const REMINDERS_MARK = 'Reminders 里勾了完成';
const GATED_EDGE = /\*\*done→review\*\*\s*·\s*`hermes`/;

function headlineOf(entryText: string): string {
  return entryText.split('\n')[0];
}

export function hasUserDoneConfirmation(body: string): boolean {
  const entries = parseLogEntries(body);
  const doneIndex = entries.findIndex((entry) => TO_DONE.test(entry.text));
  if (doneIndex < 0) {
    // No done edge in the log (e.g. Reminders sync set status directly): there is no edge to
    // window against — judge over the whole log (legacy shape, kept for sync compatibility).
    // Citations are NOT accepted here: they must anchor to a done edge, otherwise an old
    // citation from a previous cycle could be reused (audit C2).
    if (entries.some((entry) => USER_ACTOR.test(headlineOf(entry.text)))) return true;
    return entries.some((entry) => entry.text.includes(REMINDERS_MARK));
  }
  // Logs are newest-first. The done entry itself and smaller indices are chronologically
  // at/after the done edge. All channels are judged in this window only — markers that
  // predate the done edge do not confirm it.
  const atOrAfterDone = [entries[doneIndex], ...entries.slice(0, doneIndex)];
  if (atOrAfterDone.some((entry) => USER_ACTOR.test(headlineOf(entry.text)))) return true;
  if (atOrAfterDone.some((entry) => entry.text.includes(REMINDERS_MARK))) return true;
  return atOrAfterDone.some((entry) => USER_CONFIRM.test(entry.text));
}

// Disarms re-gating only on the gate's own canonical entry (done→review by hermes carrying the
// marker text). Prose quoting the sentence — even the full constant — must not disarm: the gate
// entry has a structural shape prose cannot accidentally take.
function hasGateMarker(body: string): boolean {
  return parseLogEntries(body).some(
    (entry) => GATED_EDGE.test(headlineOf(entry.text)) && entry.text.includes(REVIEW_GATE_TEXT),
  );
}

export function shouldGuardExternalDone(previous: Status, task: Task, body: string): boolean {
  return (
    !TERMINAL_STATUSES.includes(previous) &&
    task.status === 'done' &&
    (task.assignee ?? '') !== 'user' &&
    !hasGateMarker(body) &&
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
  revalidateReviewGate(path: string, now: Date): Promise<boolean>;
}

// FR-030b debounce (approved 2026-08-28): after the gate bounces a done write back to review,
// a single re-read is scheduled N seconds later. If a confirmation channel has landed by then
// (the agent's citation from the two-step done write), the done state is restored and a
// release entry recorded. If not, the review bounce stands and NOTHING is written (no second
// intervention entry — acceptance criterion "干预记录不重复落").
//
// Idempotency: the release entry text doubles as the disarm marker. A second revalidate pass
// (or a re-gated file that already carries a release) must never double-release, and a user
// confirmation that arrived inside the window leaves the file to the normal confirmation
// channels — we only restore what we ourselves bounced.
export const REVIEW_RELEASE_TEXT = '复核门禁放行：防抖窗口内确认已补齐，恢复 done（FR-030b）';

function hasReleaseMarker(body: string): boolean {
  return parseLogEntries(body).some(
    (entry) => entry.text.includes(REVIEW_RELEASE_TEXT),
  );
}

// Pure half of the revalidate: does this (task, body) qualify for a release right now?
// Requires: status is review (our bounce), the gate's own intervention entry exists (so we
// never release a review a human set), no release yet, and a confirmation channel present.
export function shouldReleaseAfterDebounce(task: Task, body: string): boolean {
  return (
    task.status === 'review' &&
    hasGateMarker(body) &&
    !hasReleaseMarker(body) &&
    hasUserDoneConfirmation(body)
  );
}

// Pure half of the release: status back to done + completed restored + release entry.
export function applyReviewRelease(task: Task, body: string, now: Date): { task: Task; body: string } {
  const released = { ...task, status: 'done' as const, completed: localIsoMinute(now) };
  return {
    task: released,
    body: recordEntry(body, {
      ts: now,
      actor: AUTO_ACTOR,
      text: REVIEW_RELEASE_TEXT,
    }),
  };
}

// `YYYY-MM-DDTHH:MM` local — the on-disk `completed` stamp format (statusMachine).
export function localIsoMinute(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

