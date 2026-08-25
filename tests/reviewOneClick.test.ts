import { describe, expect, it } from 'vitest';
import { createT } from '../src/i18n';
import { STATUSES, type Task } from '../src/model/types';
import { isLegalTransition } from '../src/model/statusMachine';
import { renderTaskRow, reviewActions, type RowActions } from '../src/view/taskRow';

// FR-049 review one-click: status=review renders exactly the two decisions (confirm → done,
// rework → doing); every other state renders none (FR-046 — no resident noise). reviewActions
// is the single pure source both the row and the detail popover render from.
describe('reviewActions (FR-049 pure source)', () => {
  it('returns the two decisions for review, in confirm-then-rework order', () => {
    const acts = reviewActions('review');
    expect(acts.map((a) => a.to)).toEqual(['done', 'doing']);
    expect(acts.map((a) => a.label)).toEqual(['✅ 确认完成', '↩ 打回 doing']);
    expect(acts.map((a) => a.cls)).toEqual(['tv-review-confirm', 'tv-review-rework']);
  });

  it('returns [] for every non-review status', () => {
    for (const s of STATUSES.filter((x) => x !== 'review')) {
      expect(reviewActions(s)).toEqual([]);
    }
  });

  it('follows the injected translator (en)', () => {
    const acts = reviewActions('review', createT('en'));
    expect(acts.map((a) => a.label)).toEqual(['✅ Confirm done', '↩ Send back to doing']);
  });
});

// Minimal fake DOM: renderTaskRow only needs createDiv/createSpan/createEl + event listeners.
function fakeEl(): any {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const el: any = {
    children: [] as any[],
    classes: [] as string[],
    attrs: {} as Record<string, string>,
    text: '',
    listeners, // exposed so tests can fire a single listener with a spy event
    addEventListener(type: string, fn: (e: any) => void) {
      (listeners[type] ??= []).push(fn);
    },
    click() {
      for (const fn of listeners['click'] ?? []) fn({ stopPropagation: () => {} });
    },
    toggleClass(cls: string, on: boolean) {
      this.classes = on
        ? [...new Set([...this.classes, cls])]
        : this.classes.filter((c: string) => c !== cls);
    },
    createDiv(opts?: any) {
      return this.adopt(opts, 'div');
    },
    createSpan(opts?: any) {
      return this.adopt(opts, 'span');
    },
    createEl(_tag: string, opts?: any) {
      return this.adopt(opts, 'el');
    },
    adopt(opts: any, _kind: string) {
      const child = fakeEl();
      // Obsidian accepts a single space-joined class string; split it so class lookups work.
      if (opts?.cls) {
        child.classes = Array.isArray(opts.cls) ? opts.cls : String(opts.cls).split(/\s+/);
      }
      if (opts?.text) child.text = opts.text;
      if (opts?.attr) child.attrs = opts.attr;
      this.children.push(child);
      return child;
    },
  };
  return el;
}

function findReviewButtons(root: any): any[] {
  const out: any[] = [];
  const walk = (el: any): void => {
    if (el.classes?.includes('tv-review-act')) out.push(el);
    for (const c of el.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

const TASK: Task = {
  id: 'uuid-1',
  title: 'review me',
  status: 'review',
  created: '2026-08-25T09:00',
};

function render(status: Task['status'], actions?: RowActions, effectiveStatus?: Task['status']): any {
  const parent = fakeEl();
  renderTaskRow(parent, { ...TASK, status }, {
    effectiveStatus: effectiveStatus ?? status,
    blockSources: [],
    now: new Date('2026-08-25T10:00'),
    path: '03 Tasks/x/2026-08-25/review-me.md',
    ...(actions ? { actions } : {}),
    t: createT('zh-CN'),
  });
  return parent.children[0];
}

describe('renderTaskRow review one-click (FR-049)', () => {
  it('renders both inline action buttons only when status=review', () => {
    const btns = findReviewButtons(render('review'));
    expect(btns.map((b) => b.text)).toEqual(['✅ 确认完成', '↩ 打回 doing']);
    expect(btns.map((b) => b.classes)).toEqual([
      ['tv-tag', 'tv-review-act', 'tv-review-confirm'],
      ['tv-tag', 'tv-review-act', 'tv-review-rework'],
    ]);
  });

  it('renders no inline action for non-review statuses', () => {
    for (const s of STATUSES.filter((x) => x !== 'review')) {
      expect(findReviewButtons(render(s))).toEqual([]);
    }
  });

  it('renders the actions from the REAL status, not the derived effectiveStatus (PR #33 nit)', () => {
    // Stored status=review, but a dependency makes the derived overlay say "blocked".
    // The review decision buttons must still render — a review action is only honest
    // against the actual frontmatter state.
    const btns = findReviewButtons(render('review', undefined, 'blocked'));
    expect(btns.map((b) => b.text)).toEqual(['✅ 确认完成', '↩ 打回 doing']);
  });

  it('routes button clicks through the reviewDecision handler (→ setStatus seam)', () => {
    const calls: Array<'done' | 'doing'> = [];
    const actions: RowActions = {
      complete: () => {},
      reschedule: () => {},
      openDetail: () => {},
      openDoc: () => {},
      reviewDecision: (_task, to) => calls.push(to),
    };
    const btns = findReviewButtons(render('review', actions));
    btns[0].click(); // ✅ confirm
    btns[1].click(); // ↩ rework
    expect(calls).toEqual(['done', 'doing']);
  });

  // Clicking a review button must never bubble to the row-level openDoc handler —
  // the whole row is a click target, so an un-stopped event would open the document
  // underneath the decision the user just made (PR #33 nit).
  it('stops propagation on review button clicks — openDoc never fires', () => {
    const events: string[] = [];
    const actions: RowActions = {
      complete: () => {},
      reschedule: () => {},
      openDetail: () => {},
      openDoc: () => events.push('openDoc'),
      reviewDecision: () => events.push('reviewDecision'),
    };
    const row = render('review', actions);
    const btn = findReviewButtons(row)[0];
    let rowClick: ((e: unknown) => void) | undefined;
    let stopped = false;
    for (const fn of row.listeners.click ?? []) {
      // Keep the original row listener (openDoc) but only record it — we assert on
      // dispatch order manually below.
      rowClick = fn;
    }
    expect(rowClick).toBeDefined(); // the row registers its openDoc click handler
    for (const fn of btn.listeners.click ?? []) {
      // Simulate the browser: pass an event whose stopPropagation is observable.
      fn({
        stopPropagation: () => {
          stopped = true;
        },
      });
    }
    // The button's own handler called stopPropagation and routed the decision…
    expect(stopped).toBe(true);
    expect(events).toEqual(['reviewDecision']);
    // …while a raw row-level click (no stopPropagation) still opens the doc.
    rowClick!({});
    expect(events).toEqual(['reviewDecision', 'openDoc']);
  });
});

// The wire contract: both decisions must be legal machine transitions from review (FR-030),
// so the setStatus seam accepts them and persists the migration entry.
describe('review decision transitions (FR-030 gate)', () => {
  it('review → done and review → doing are legal transitions', () => {
    expect(isLegalTransition('review', 'done')).toBe(true);
    expect(isLegalTransition('review', 'doing')).toBe(true);
  });
});
