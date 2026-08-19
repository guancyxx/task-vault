// Execution-log protocol (FR-018, contract §7). Pure append into `## 执行记录`.
// Reuses the body-section helpers from frontmatter IO; touches no other body content.

import type { Actor, Status } from '../model/types';
import { getSection, upsertSection } from '../util/frontmatter';

export const LOG_HEADING = '## 执行记录';

// Typed entries (contract §7): 决策/评论/卡点. Plain progress carries no kind.
export type EntryKind = '决策' | '评论' | '卡点';

export interface EntryInput {
  ts: Date;
  actor: Actor;
  kind?: EntryKind; // typed entry → `[kind]`
  from?: Status; // migration record → `[from→to]`
  to?: Status;
  text: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Local `YYYY-MM-DD HH:MM` — the on-disk stamp format (contract §7).
function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

// Layout (user request 2026-08-19): metadata on the bullet line, prose on its own indented
// line beneath it. Long entries used to run off the right edge behind their own brackets; this
// way the timestamp/kind/actor column stays scannable and the text reads as a paragraph.
// The `- YYYY-MM-DD HH:MM ` prefix is load-bearing — dispatch_backstop.py matches on it.
export function formatEntry(e: EntryInput): string {
  // Migration tag wins over kind when both are supplied (transition is the salient fact).
  let tag = '';
  if (e.from && e.to) tag = ` · **${e.from}→${e.to}**`;
  else if (e.kind) tag = ` · **${e.kind}**`;
  const head = `- ${stamp(e.ts)}${tag} · \`${e.actor}\``;
  const text = e.text.trim();
  return text ? `${head}\n${indent(text)}` : head;
}

// Continuation lines of a markdown list item: two spaces, matching the `- ` bullet width.
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`.trimEnd())
    .join('\n');
}

// Write one entry into `## 执行记录`, creating the section (with heading) if absent.
// Newest FIRST (user request 2026-08-19): a long-running task's latest state is what you open the
// note for, and Obsidian renders the file as-is — there is no view layer to reverse it for us.
// Still insert-only: existing entries are never rewritten (铁律 2).
export function recordEntry(body: string, e: EntryInput): string {
  const line = formatEntry(e);
  const existing = getSection(body, LOG_HEADING);
  // Blank line between entries: renders as a loose list, which is what gives the log air.
  const content = existing && existing.length > 0 ? `${line}\n\n${existing}` : line;
  return upsertSection(body, LOG_HEADING, content);
}
