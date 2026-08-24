// FR-040 (revision 2026-08-24): form→Capture assembly for the 新建任务 modal — pure so it
// unit-tests without Obsidian. The modal collects {title, project, priority, dueText}; this
// module turns it into the same Capture the capture-box grammar produces, so the file write
// still rides the one canonical seam (VaultSource.createTaskFile → captureToTask).
//
// Design notes:
// - Project list source: projectStats over the store's tasks (the same derivation the projects
//   panel uses), so a picked name maps 1:1 to an on-disk 03 Tasks/<project>/ folder.
// - dueText is optional natural language (nlDateParser: 明天3点 / 后天 / 周五 / ISO) — '' means
//   "today 22:00", which captureToTask already applies as its default, so we simply omit `due`.
// - An unparsable dueText is an error (validated BEFORE submit), never silently dropped.

import type { Priority, Task } from '../model/types';
import { parseNlDate } from '../time/nlDateParser';
import type { Capture } from './captureParse';

export interface NewTaskFormValue {
  title: string;
  project: string; // '' = leave uncategorized (_未分类)
  priority: '' | Priority;
  dueText: string; // '' = today 22:00 (captureToTask default)
}

export type NewTaskFormResult =
  | { ok: true; capture: Capture }
  | { ok: false; reason: 'emptyTitle' | 'badDue'; duePreview?: string };

// Known project names from indexed tasks (project field → repo/* tag), de-wikilinked and
// deduped, sorted case-insensitively. Pure over plain Task[].
export function knownProjects(tasks: Pick<Task, 'project' | 'tags'>[]): string[] {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.project) {
      const m = /^\[\[(.+)\]\]$/.exec(t.project.trim());
      names.add((m ? m[1] : t.project.trim()));
    } else {
      const repo = (t.tags ?? []).find((tg) => tg.startsWith('repo/'));
      if (repo) names.add(repo.slice('repo/'.length));
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

// Assemble the form value into a Capture. Title trimmed (empty → error); priority optional;
// project optional; dueText parsed by nlDateParser and ONLY accepted when the whole input is
// consumed (a bare time like "15:00" parses fine; "明天 顺便" would leave junk → badDue).
export function formToCapture(value: NewTaskFormValue, now: Date): NewTaskFormResult {
  const title = value.title.replace(/\s+/g, ' ').trim();
  if (title === '') return { ok: false, reason: 'emptyTitle' };

  const capture: Capture = { title };
  if (value.priority !== '') capture.priority = value.priority;
  if (value.project.trim() !== '') capture.project = value.project.trim();

  if (value.dueText.trim() !== '') {
    const nl = parseNlDate(value.dueText.trim(), now);
    if (!nl || nl.consumed.replace(/\s+/g, ' ').trim() !== '') {
      return { ok: false, reason: 'badDue', duePreview: value.dueText };
    }
    capture.due = nl.due;
    capture.dueIsDateTime = nl.dueIsDateTime;
    if (nl.remind) capture.remind = nl.remind;
  }

  return { ok: true, capture };
}

// Live preview for the due field: returns the resolved due string for display, or null when
// the current text doesn't parse (the modal greys the preview + submit hint).
export function previewDue(dueText: string, now: Date): string | null {
  const trimmed = dueText.trim();
  if (trimmed === '') return null; // '' = default; the modal renders its own hint text
  const nl = parseNlDate(trimmed, now);
  if (!nl || nl.consumed.replace(/\s+/g, ' ').trim() !== '') return null;
  return nl.due;
}
