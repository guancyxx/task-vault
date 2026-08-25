import { describe, expect, it } from 'vitest';
import { projectDisplay } from '../src/view/projectDetailView';
import type { Entry } from '../src/store/taskStore';
import type { Task } from '../src/model/types';

// Audit 08-25 round 3: the detail view's `project` may hold a legacy folded key from an old
// workspace state. UI text (tab title, page header, empty fallback) must recover the
// first-seen original spelling from the store instead of rendering the folded key.
function entry(id: string, project: string | undefined): Entry {
  return {
    path: `03 Tasks/${id}.md`,
    task: { id, title: id, status: 'todo', created: '2026-08-25T09:00', project } as Task,
    body: '',
  };
}

describe('projectDisplay (audit 08-25 r3: no folded key in UI text)', () => {
  it('recovers the original spelling when state holds a legacy folded key', () => {
    const entries = [entry('a', 'Edu-Agent'), entry('b', 'edu-agent')];
    expect(projectDisplay('edu-agent', entries)).toBe('Edu-Agent');
  });

  it('passes a display spelling through unchanged when tasks match', () => {
    const entries = [entry('a', 'Edu-Agent')];
    expect(projectDisplay('Edu-Agent', entries)).toBe('Edu-Agent');
  });

  it('returns empty when no task matches — stale state never surfaces any spelling (r4)', () => {
    // Legacy folded key OR display spelling with zero matches: the project no longer exists;
    // callers must fall back to the generic localized title instead of showing the raw string.
    expect(projectDisplay('edu-agent', [])).toBe('');
    expect(projectDisplay('Edu-Agent', [])).toBe('');
  });

  it('strips wikilinks in the recovered spelling', () => {
    const entries = [entry('a', '[[Task Vault]]')];
    expect(projectDisplay('task vault', entries)).toBe('Task Vault');
  });
});
