import { describe, expect, it } from 'vitest';
import { createT } from '../src/i18n';
import { formToCapture, knownProjects, previewDue } from '../src/view/newTaskForm';
import { CREATE_COMMAND_ROWS } from '../src/view/newProjectModal';

// FR-040 revision (2026-08-24): the new-task form assembly + the hotkey rebind P→J.

const NOW = new Date('2026-08-24T10:00:00'); // local time, Monday

describe('hotkey rebind: new-project P → J (core Cmd+Shift+P collision)', () => {
  it('new-task stays N, new-project is now J', () => {
    expect(CREATE_COMMAND_ROWS.map((r) => `${r.id}:${r.key}`)).toEqual([
      'new-task:N',
      'new-project:J',
    ]);
  });

  it('name keys still resolve in both dictionaries', () => {
    for (const lang of ['zh-CN', 'en'] as const) {
      const t = createT(lang);
      for (const row of CREATE_COMMAND_ROWS) expect(t(row.nameKey).length).toBeGreaterThan(0);
    }
  });
});

describe('formToCapture (new-task form → Capture)', () => {
  it('title only: everything optional omitted, no due (captureToTask applies today-22:00 default)', () => {
    const res = formToCapture({ title: '  写周报  ', project: '', priority: '', dueText: '' }, NOW);
    expect(res).toEqual({ ok: true, capture: { title: '写周报' } });
  });

  it('full form: project + priority + NL due all land in the Capture', () => {
    const res = formToCapture(
      { title: '发版', project: 'task-vault', priority: 'high', dueText: '明天下午3点' },
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.capture.title).toBe('发版');
    expect(res.capture.project).toBe('task-vault');
    expect(res.capture.priority).toBe('high');
    expect(res.capture.due).toBe('2026-08-25T15:00');
    expect(res.capture.dueIsDateTime).toBe(true);
  });

  it('empty/whitespace title → emptyTitle error, not a file', () => {
    for (const title of ['', '   ']) {
      expect(formToCapture({ title, project: '', priority: '', dueText: '' }, NOW)).toEqual({
        ok: false,
        reason: 'emptyTitle',
      });
    }
  });

  it('unparsable due → badDue (never silently dropped)', () => {
    const res = formToCapture({ title: 'x', project: '', priority: '', dueText: '啥时候再说吧' }, NOW);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('badDue');
  });

  it('due with leftover junk after parsing → badDue (partial consumption rejected)', () => {
    // "明天" parses but leaves "顺便" — the grammar's own behavior keeps junk in the title;
    // for the FORM the due field must be a pure time phrase.
    const res = formToCapture({ title: 'x', project: '', priority: '', dueText: '明天 顺便' }, NOW);
    expect(res.ok).toBe(false);
  });

  it('whitespace-only project is treated as uncategorized (no project key)', () => {
    const res = formToCapture({ title: 'x', project: '   ', priority: '', dueText: '' }, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect('project' in res.capture).toBe(false);
  });
});

describe('knownProjects (dropdown source, 1:1 with disk folders)', () => {
  it('derives from project field (wikilink stripped) and repo/* tags, deduped + sorted', () => {
    const tasks = [
      { project: '[[task-vault]]', tags: [] },
      { project: 'edu-agent', tags: [] },
      { project: undefined, tags: ['repo/magicedit', 'urgent'] },
      { project: 'task-vault', tags: [] }, // duplicate of the wikilink form after stripping
      { project: undefined, tags: [] },
    ];
    expect(knownProjects(tasks)).toEqual(['edu-agent', 'magicedit', 'task-vault']);
  });
});

describe('previewDue (live due preview)', () => {
  it('resolves NL phrases and bare ISO; null on junk and empty', () => {
    expect(previewDue('明天下午3点', NOW)).toBe('2026-08-25T15:00');
    // grammar fact (matches nlDateParser): bare 3点 without a period word = 3 AM, not 15:00
    expect(previewDue('明天3点', NOW)).toBe('2026-08-25T03:00');
    expect(previewDue('2026-08-26', NOW)).toBe('2026-08-26');
    expect(previewDue('', NOW)).toBeNull();
    expect(previewDue('不解析的词', NOW)).toBeNull();
  });
});
