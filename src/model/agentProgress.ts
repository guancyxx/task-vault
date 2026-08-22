// Agent execution-phase derivation (FR-028). Pure function: task frontmatter + body
// `## 执行记录` → one of four phases, so the sidebar can show live agent progress without
// agents writing any extra state. Only applies to delegated tasks (assignee ≠ user).
//
// Judgement mirrors dispatch_backstop.py (text-matching「接单」/「卡点」on log entries —
// the same load-bearing protocol, contract §7); status=review is the FR-030 delivery gate.
//
// Phases:
//   dispatched — `dispatched` set ∧ no「接单」entry yet (agent has not picked up)
//   working    —「接单」logged ∧ the NEWEST progress entry is not a 卡点
//   stuck      — the newest progress entry is a「卡点」(needs human attention)
//   review     — status=review (agent finished, waiting for user confirmation)

import type { Task } from './types';
import { getSection } from '../util/frontmatter';

export type AgentPhase = 'dispatched' | 'working' | 'stuck' | 'review';

export interface AgentProgress {
  phase: AgentPhase;
  /** Latest log-entry timestamp (`YYYY-MM-DD HH:MM` local) — drives the `·Xh` staleness chip. */
  lastActivity?: string;
}

// One log entry = `- YYYY-MM-DD HH:MM …` bullet + its indented continuation lines
// (same entry-boundary rule as dispatch_backstop.py's LOG_ENTRY — do not drift).
const ENTRY_HEAD = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s/;

interface LogEntry {
  stamp: string;
  text: string; // head line + continuations, joined
}

export function parseLogEntries(body: string): LogEntry[] {
  const sectionText = getSection(body, '## 执行记录') ?? '';
  const out: LogEntry[] = [];
  for (const line of sectionText.split('\n')) {
    const m = ENTRY_HEAD.exec(line.trim());
    if (m) {
      out.push({ stamp: m[1], text: line });
    } else if (out.length > 0 && line.trim() !== '') {
      out[out.length - 1].text += `\n${line}`;
    }
  }
  return out;
}

// Text-matching is deliberately plain substring (「接单」「卡点」), matching the backstop's
// accepted_after() and the [卡点] typed-entry format — the protocol's existing convention.
export function agentProgress(task: Task, body: string): AgentProgress | null {
  const assignee = task.assignee ?? '';
  if (assignee === '' || assignee === 'user') return null; // self tasks carry no phase

  if (task.status === 'review') return { phase: 'review' };

  const entries = parseLogEntries(body);
  // newest-first per the write protocol (recordEntry inserts at the section head)
  const newest = entries[0];

  if (task.status === 'todo') {
    // Not picked up: a real dispatch exists but no 接单 after (or without) it.
    const accepted = entries.some((e) => e.text.includes('接单'));
    if (task.dispatched && !accepted) return { phase: 'dispatched' };
    return null; // default-ownership todo (assignee never dispatched) is not agent-active
  }

  if (newest && newest.text.includes('卡点')) {
    return { phase: 'stuck', lastActivity: newest.stamp };
  }

  if (task.status === 'doing' || task.status === 'waiting') {
    return { phase: 'working', lastActivity: newest?.stamp };
  }

  return null; // done/cancelled/blocked/inbox: no live phase
}
