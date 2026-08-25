// Task file placement: `03 Tasks/<project>/<YYYY-MM-DD>/<slug>.md` — project folder on top,
// a full-date (year-month-day) folder as the middle layer, and a slug-only filename (NO date
// prefix in the name/title). User decision 2026-08-19: 按天存放（年月日目录），标题不带日期。
//
// Resolution order for the project folder name:
//   1. frontmatter `project` (wikilink "[[x]]" stripped, raw "x" as-is)
//   2. first `repo/<name>` tag (migrated legacy tasks carry repo/* in tags)
//   3. `_未分类`
//
// Changing `project` legitimately relocates the file: identity (id) and mirror are untouched —
// only the path moves. The date folder follows `created` (stable) — never due.

import type { Task } from '../model/types';

export const UNCATEGORIZED = '_未分类';
export const TASKS_ROOT = '03 Tasks';

const PROJECT_LINK = /^\[\[(.+)\]\]$/;

export function projectFolder(task: Pick<Task, 'project' | 'tags'>): string {
  if (task.project) {
    const m = PROJECT_LINK.exec(task.project.trim());
    return sanitize(m ? m[1] : task.project.trim());
  }
  const repo = (task.tags ?? []).find((t) => t.startsWith('repo/'));
  if (repo) return sanitize(repo.slice('repo/'.length));
  return UNCATEGORIZED;
}

// Date folder from the task's created timestamp (`YYYY-MM-DD`).
export function dateFolder(task: Pick<Task, 'created'>): string {
  return (task.created ?? '').slice(0, 10) || 'unknown';
}

export function taskDir(task: Pick<Task, 'project' | 'tags' | 'created'>): string {
  return `${TASKS_ROOT}/${projectFolder(task)}/${dateFolder(task)}`;
}

export function taskPath(task: Pick<Task, 'project' | 'tags' | 'created'>, fileName: string): string {
  return `${taskDir(task)}/${fileName}`;
}

// A path belongs to the task library when it sits under 03 Tasks/ at ANY depth except _archive.
export function isLibraryPath(path: string): boolean {
  return path.startsWith(`${TASKS_ROOT}/`) && !path.startsWith(`${TASKS_ROOT}/_archive/`) && path.endsWith('.md');
}

// Filesystem-safe folder name: strip slashes/control chars and leading dots, collapse spaces.
function sanitize(name: string): string {
  const cleaned = name
    .replace(/[/\\:?*"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned === '' ? UNCATEGORIZED : cleaned;
}

// Case-insensitive project identity (2026-08-25, user decision): agents historically wrote
// the same project with different casings (Task Vault / task-vault). Grouping, sorting, stats,
// and detail filtering must key on this FOLDED form so spelling variants aggregate, while
// display keeps the first-seen original casing (projectFolder). macOS FS is case-insensitive
// so on disk both spellings already resolve to one folder; this makes the UI agree.
export function projectKey(task: Pick<Task, 'project' | 'tags'>): string {
  return projectFolder(task).toLowerCase();
}
