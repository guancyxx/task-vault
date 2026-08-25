import { describe, expect, it } from 'vitest';
import { countClass, projectCount, projectGroups, restoreCapture, snapshotCapture } from '../src/view/sidebarView';
import { UNCATEGORIZED } from '../src/store/taskPaths';
import type { Entry } from '../src/store/taskStore';
import type { Task } from '../src/model/types';

// FR-047 count semantics: a non-zero overdue/review/today count gets a bucket-coloured pill class;
// week/done and any zero count stay the bare grey tv-count. Pure — the render just spreads the array.
describe('countClass (FR-047 count semantics)', () => {
  it('overlays a bucket class only when the alert buckets are non-zero', () => {
    expect(countClass('overdue', 3)).toEqual(['tv-count', 'tv-count-alert']);
    expect(countClass('review', 1)).toEqual(['tv-count', 'tv-count-review']);
    expect(countClass('today', 2)).toEqual(['tv-count', 'tv-count-today']);
  });

  it('stays bare grey for week/done and for any zero count', () => {
    expect(countClass('week', 9)).toEqual(['tv-count']);
    expect(countClass('done', 4)).toEqual(['tv-count']);
    expect(countClass('overdue', 0)).toEqual(['tv-count']);
    expect(countClass('review', 0)).toEqual(['tv-count']);
    expect(countClass('today', 0)).toEqual(['tv-count']);
  });
});

// FR-044 heartbeat guard (audit C1): the capture-input snapshot/restore pair is what keeps
// in-flight typing alive across the 60s re-render. The DOM behaviours themselves (focus,
// setSelectionRange, composition skip) are exercised in-app per SC-023; these pin the data
// contract the render relies on. A minimal input stand-in carries the same fields.
describe('capture snapshot/restore (FR-044, audit C1)', () => {
  const makeInput = (over: Partial<HTMLInputElement> = {}): HTMLInputElement =>
    Object.assign(
      {
        value: '',
        selectionStart: null,
        selectionEnd: null,
        focus: () => {},
        setSelectionRange: () => {
          throw new Error('setSelectionRange should not run with null selection');
        },
      },
      over,
    ) as unknown as HTMLInputElement;

  it('snapshot captures value and selection (focused=false in Node — no document)', () => {
    const input = makeInput({ value: 'half-typed !high @proj', selectionStart: 4, selectionEnd: 9 });
    const snap = snapshotCapture(input);
    expect(snap.value).toBe('half-typed !high @proj');
    expect(snap.selectionStart).toBe(4);
    expect(snap.selectionEnd).toBe(9);
    expect(snap.focused).toBe(false); // Node has no document; prod passes the real check
  });

  it('restore writes value back and honors focused=false (no focus() call)', () => {
    let focused = 0;
    const input = makeInput({ focus: () => { focused += 1; }, selectionStart: null, selectionEnd: null });
    restoreCapture(input, { value: 'typed', focused: false, selectionStart: null, selectionEnd: null });
    expect(input.value).toBe('typed');
    expect(focused).toBe(0);
  });

  it('restore calls focus() exactly once when the snapshot says focused, and applies selection', () => {
    let focused = 0;
    const ranges: Array<[number | null, number | null]> = [];
    const input = makeInput({
      focus: () => { focused += 1; },
      setSelectionRange: (s: number | null, e: number | null) => { ranges.push([s, e]); },
    });
    restoreCapture(input, { value: 'typed', focused: true, selectionStart: 0, selectionEnd: 6 });
    expect(input.value).toBe('typed');
    expect(focused).toBe(1);
    expect(ranges).toEqual([[0, 6]]);
  });

  it('restore skips setSelectionRange when the snapshot selection is null', () => {
    const ranges: Array<[number | null, number | null]> = [];
    const input = makeInput({ setSelectionRange: (s: number | null, e: number | null) => { ranges.push([s, e]); } });
    restoreCapture(input, { value: 'x', focused: false, selectionStart: null, selectionEnd: null });
    expect(ranges).toEqual([]);
  });
});

// Sidebar wikilink fix: the divider count key must equal the render loop's grouping key — both
// derive from taskPaths.projectFolder, so project "[[学习]]" and bare 学习 count as ONE project
// (no split group), and the uncategorized cluster counts under the localized label.
describe('projectCount wikilink grouping key', () => {
  const UNCAT_LABEL = '未分类';
  function entry(id: string, extra: Partial<Task> = {}): Entry {
    return {
      path: `03 Tasks/${id}.md`,
      task: { id, title: id, status: 'todo', created: '2026-08-19T09:00', ...extra } as Task,
      body: '',
    };
  }

  it('counts wikilink and bare spellings of the same project together', () => {
    const roots = [
      entry('bare', { project: '学习' }),
      entry('link', { project: '[[学习]]' }),
      entry('other', { project: '别的项目' }),
    ];
    expect(projectCount(roots, '学习', UNCAT_LABEL)).toBe(2);
    expect(projectCount(roots, '别的项目', UNCAT_LABEL)).toBe(1);
  });

  it('counts uncategorized under the STABLE key, never the localized label', () => {
    const roots = [
      entry('none', { project: undefined }),
      entry('repo', { project: undefined, tags: ['repo/-repository'] }),
      entry('named', { project: 'x' }),
    ];
    expect(projectCount(roots, UNCATEGORIZED, UNCAT_LABEL)).toBe(1); // repo/* derives its own folder
    expect(projectCount(roots, 'x', UNCAT_LABEL)).toBe(1);
  });

  it('a real project equal to the localized uncat label does NOT merge with uncategorized', () => {
    // Audit 08-25 collision guard: keys are stable pf values, the localized label is display-only.
    const roots = [
      entry('none', { project: undefined }),
      entry('named-uncat', { project: '未分类' }), // real project that collides with the zh label
    ];
    expect(projectCount(roots, UNCATEGORIZED, UNCAT_LABEL)).toBe(1);
    expect(projectCount(roots, '未分类', UNCAT_LABEL)).toBe(1);
  });

  it('projectGroups keys boundaries on the stable pf — colliding display names stay separate groups', () => {
    // Re-audit 08-25: the render loop's group boundary must compare pf, not the localized
    // display name — otherwise a project literally named 未分类 would merge with the
    // uncategorized cluster (identical display names, one divider, shared fold state).
    const roots = [
      entry('named-uncat', { project: '未分类' }),
      entry('none', { project: undefined }), // displays as 未分类 too
      entry('plain', { project: '学习' }),
    ];
    const groups = projectGroups(roots, 'today');
    expect(groups.map((g) => g.pf)).toEqual(['未分类', UNCATEGORIZED, '学习']);
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1]);
    // fold keys differ even when display names collide
    expect(groups[0].key).not.toBe(groups[1].key);
  });

  it('projectGroups merges wikilink and bare spellings into one consecutive run', () => {
    const roots = [
      entry('bare', { project: '学习' }),
      entry('link', { project: '[[学习]]' }),
    ];
    const groups = projectGroups(roots, 'today');
    expect(groups).toHaveLength(1);
    expect(groups[0].pf).toBe('学习');
    expect(groups[0].rows).toHaveLength(2);
  });
});
