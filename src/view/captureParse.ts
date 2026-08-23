// Quick-capture parsing (FR-010, FR-012, contract §5). Pure functions — the sidebar's Enter
// handler (adapter below in sidebarView) does the actual file create via the Vault API.
//
// Grammar: `!high|!normal|!low` priority, `@project`, `#tag` (repeatable), plus a Chinese NL
// time phrase (nlDateParser). Metadata tokens are stripped first, then the remainder goes to the
// NL parser; whatever it leaves (`consumed`) is the title. Empty title → null (caller keeps the
// raw text, no file). Status = todo when a due is present, else inbox (FR-012).

import type { Priority, Source, Task } from '../model/types';
import { parseNlDate } from '../time/nlDateParser';

export interface Capture {
  title: string;
  priority?: Priority;
  project?: string;
  tags?: string[];
  start?: string;
  due?: string;
  dueIsDateTime?: boolean;
  remind?: string;
}

const PRIORITY = /!(high|normal|low)\b/;
const PROJECT = /@([^\s#!@]+)/;
const TAG = /#([^\s#!@]+)/g;

export function parseCapture(text: string, now: Date): Capture | null {
  let rest = text;
  const capture: Capture = { title: '' };

  const pm = PRIORITY.exec(rest);
  if (pm) {
    capture.priority = pm[1] as Priority;
    rest = rest.replace(PRIORITY, ' ');
  }

  const prj = PROJECT.exec(rest);
  if (prj) {
    capture.project = prj[1];
    rest = rest.replace(PROJECT, ' ');
  }

  const tags: string[] = [];
  for (let m = TAG.exec(rest); m; m = TAG.exec(rest)) tags.push(m[1]);
  if (tags.length) {
    capture.tags = tags;
    rest = rest.replace(TAG, ' ');
  }

  const nl = parseNlDate(rest, now);
  if (nl) {
    capture.due = nl.due;
    capture.dueIsDateTime = nl.dueIsDateTime;
    if (nl.start) capture.start = nl.start;
    if (nl.remind) capture.remind = nl.remind;
    rest = nl.consumed;
  }

  const title = rest.replace(/\s+/g, ' ').trim();
  if (title === '') return null;
  capture.title = title;
  return capture;
}

// contract §5: lowercase, spaces→-, keep [a-z0-9一-鿿-], collapse/trim -, cap 50, empty→task.
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9一-鿿-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, ''); // a trailing dash created by the slice
  return slug === '' ? 'task' : slug;
}

function localIsoMinute(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function captureToTask(c: Capture, opts: { id: string; now: Date; source?: Source }): Task {
  // No explicit DDL → due today 22:00 (user rule 2026-08-19: 没说明 ddl 就当天 22 点).
  const due = c.due ?? localIsoMinute(new Date(opts.now.getFullYear(), opts.now.getMonth(), opts.now.getDate(), 22, 0));
  const task: Task = {
    id: opts.id,
    title: c.title,
    status: 'todo',
    created: localIsoMinute(opts.now),
    due,
    source: opts.source ?? 'user',
  };
  if (c.start) task.start = c.start;
  task.due = due;
  if (c.remind) task.remind = c.remind;
  if (c.priority) task.priority = c.priority;
  if (c.project) task.project = c.project;
  if (c.tags && c.tags.length) task.tags = c.tags;
  return task;
}

// Legacy single-level helper: builds `<dir>/<dateStr>-<slug>.md` with -2/-3… collision
// suffixes. Canonical layout is `03 Tasks/<项目>/<YYYY-MM-DD>/<slug>.md` (taskPaths.ts,
// slug-only filename, no date prefix); this helper has no production caller, kept for tests.
export function resolveTaskPath(
  dir: string,
  dateStr: string,
  slug: string,
  exists: (path: string) => boolean,
): string {
  const base = `${dir}/${dateStr}-${slug}`;
  if (!exists(`${base}.md`)) return `${base}.md`;
  for (let n = 2; ; n++) {
    const path = `${base}-${n}.md`;
    if (!exists(path)) return path;
  }
}
