// FR-035 项目面板统计 — pure derivation from a task array, no obsidian dependency so it unit-tests
// against plain Task[]. Grouped by the same project identity the file layout uses (projectFolder:
// project field → repo/* tag → _未分类), so a card maps 1:1 to a task folder.
//
// Per-project tallies (SC-017 前半):
//   open     — inbox+todo+doing+review+waiting (the five non-terminal working states)
//   overdue  — 非终态且 due < now (timeRules.isOverdue)
//   weekDone — completed 落在本周 (timeRules.completedThisWeek)
//   agents   — assignee≠user 且非终态 (an agent is still on the hook)
// Cards sort by open desc, then overdue desc, then project name — busiest project on top.

import { projectFolder } from '../store/taskPaths';
import { completedThisWeek, isOverdue } from '../time/timeRules';
import { TERMINAL_STATUSES, type Status, type Task } from './types';

export const OPEN_STATES: readonly Status[] = ['inbox', 'todo', 'doing', 'review', 'waiting'];

export interface ProjectStat {
  project: string; // folder identity (also the detail view's key)
  open: number;
  overdue: number;
  weekDone: number;
  agents: number;
  total: number; // every task filed under the project, terminal included
}

function isTerminal(status: Status): boolean {
  return (TERMINAL_STATUSES as readonly Status[]).includes(status);
}

function isAgentInFlight(task: Task): boolean {
  const assignee = task.assignee ?? 'user';
  return assignee !== 'user' && !isTerminal(task.status);
}

export function projectStats(tasks: Task[], now: Date): ProjectStat[] {
  const byProject = new Map<string, ProjectStat>();
  for (const task of tasks) {
    const key = projectFolder(task);
    let stat = byProject.get(key);
    if (!stat) {
      stat = { project: key, open: 0, overdue: 0, weekDone: 0, agents: 0, total: 0 };
      byProject.set(key, stat);
    }
    stat.total += 1;
    if (OPEN_STATES.includes(task.status)) stat.open += 1;
    if (isOverdue(task, now)) stat.overdue += 1;
    if (completedThisWeek(task, now)) stat.weekDone += 1;
    if (isAgentInFlight(task)) stat.agents += 1;
  }
  return [...byProject.values()].sort(
    (a, b) => b.open - a.open || b.overdue - a.overdue || a.project.localeCompare(b.project, 'zh'),
  );
}
