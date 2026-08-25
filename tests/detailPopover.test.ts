// DetailModal rendering tests (PR #33/35 audit nits): the review-state action bar
// (tv-review-bar) and the decision-group UI-level mutual exclusion. The modal is
// driven through the vitest obsidian stub — Modal records its instances and hands
// out a fake contentEl, so openDetail's DOM wiring can be asserted directly without
// a real vault. The TaskActions seam is faked: these tests are about what gets
// rendered and disabled, never about the write (that is decisionFlow.test.ts).

import { afterEach, describe, expect, it } from 'vitest';
import { mkFakeEl, Modal } from './__stubs__/obsidian';
import { createT, type T } from '../src/i18n';
import type { Task } from '../src/model/types';
import type { TaskActions } from '../src/store/taskActions';
import type { TaskStore, Entry } from '../src/store/taskStore';
import { openDetail } from '../src/view/detailPopover';

const T_ZH: T = createT('zh-CN');

function makeTask(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '弹层任务', status: 'review', created: '2026-08-25T09:00', ...over };
}

function makeStore(task: Task, body: string): TaskStore {
  const entry = { task, body, error: undefined } as unknown as Entry;
  return { entryByPath: () => entry } as unknown as TaskStore;
}

interface FakeActions extends TaskActions {
  calls: {
    resolveDecision: Array<[string, string, string]>;
    setStatus: Array<[string, string]>;
  };
}

// Fake TaskActions: every method is a no-op recorder. resolveDecision is deferred —
// the caller resolves it to control when the click's re-render happens.
function makeActions(resolveWith?: (group: string, label: string) => Promise<boolean>): FakeActions {
  const calls = {
    resolveDecision: [] as Array<[string, string, string]>,
    setStatus: [] as Array<[string, string]>,
  };
  const actions = {
    calls,
    setStatus: (path: string, to: string) => {
      calls.setStatus.push([path, to]);
      return Promise.resolve(true);
    },
    resolveDecision: (path: string, group: string, label: string) => {
      calls.resolveDecision.push([path, group, label]);
      return resolveWith ? resolveWith(group, label) : Promise.resolve(true);
    },
    appendQuick: () => Promise.resolve(true),
    delegate: () => Promise.resolve('fired' as const),
    manualSummary: () => Promise.resolve(true),
  };
  return actions as unknown as FakeActions;
}

// Open the popover against a task + body; returns the modal's fake contentEl tree.
function open(task: Task, body: string, actions: FakeActions = makeActions()): any {
  const store = makeStore(task, body);
  openDetail({ vault: { getName: () => 'vault', adapter: {} } } as never, store, actions as never, 'a.md', T_ZH);
  const modal = Modal.instances[Modal.instances.length - 1] as unknown as { onOpen(): void };
  modal.onOpen();
  return (modal as unknown as { contentEl: any }).contentEl;
}

function walk(root: any, pred: (el: any) => boolean): any[] {
  const out: any[] = [];
  const go = (el: any): void => {
    if (pred(el)) out.push(el);
    for (const c of el.children ?? []) go(c);
  };
  go(root);
  return out;
}

const byClass = (root: any, cls: string): any[] =>
  walk(root, (el) => el.classes?.includes(cls));

afterEach(() => {
  Modal.instances.length = 0;
});

describe('DetailModal review action bar (tv-review-bar, PR #33 nit)', () => {
  it('renders the two review decisions in a tv-review-bar while status=review', () => {
    const root = open(makeTask({ status: 'review' }), '');
    const bars = byClass(root, 'tv-review-bar');
    expect(bars).toHaveLength(1);
    const btns = byClass(bars[0], 'tv-review-act');
    expect(btns.map((b) => b.text)).toEqual(['✅ 确认完成', '↩ 打回 doing']);
    expect(btns.map((b) => b.classes.find((c: string) => c.startsWith('tv-review-') && c !== 'tv-review-act'))).toEqual([
      'tv-review-confirm',
      'tv-review-rework',
    ]);
  });

  it('renders no bar for non-review statuses', () => {
    for (const s of ['todo', 'doing', 'done', 'blocked'] as const) {
      expect(byClass(open(makeTask({ status: s }), ''), 'tv-review-bar')).toEqual([]);
    }
  });

  it('bar buttons route through setStatus', async () => {
    const actions = makeActions();
    const root = open(makeTask({ status: 'review' }), '', actions);
    const btns = byClass(root, 'tv-review-bar')[0]
      ? byClass(byClass(root, 'tv-review-bar')[0], 'tv-review-act')
      : [];
    for (const fn of btns[0].listeners.click ?? []) fn();
    await Promise.resolve();
    expect(actions.calls.setStatus).toContainEqual(['a.md', 'done']);
  });
});

describe('decision group UI mutual exclusion (PR #35 nit)', () => {
  const BODY = ['## 决策点', '- [ ] D1 方案A', '- [ ] D1 方案B', '- [ ] D2 丙'].join('\n');

  // All buttons inside one group's tv-decision-options span, in render order.
  function groupButtons(root: any, group: string): any[] {
    const groups = byClass(root, 'tv-decision-group').filter((g) =>
      byClass(g, 'tv-decision-group-tag').some((t) => t.text === group),
    );
    expect(groups).toHaveLength(1);
    return byClass(groups[0], 'tv-decision-options')[0]
      ? byClass(byClass(groups[0], 'tv-decision-options')[0], 'tv-btn-decision')
      : [];
  }

  it('all options of a settled group render disabled when a sibling is already checked in the file', () => {
    const body = ['## 决策点', '- [x] D1 方案A ✅ 2026-08-24', '- [ ] D1 方案B'].join('\n');
    const root = open(makeTask(), body);
    const btns = groupButtons(root, 'D1');
    expect(btns).toHaveLength(2);
    expect(btns[0].disabled).toBe(true); // the checked one
    expect(btns[1].disabled).toBe(true); // the unchecked sibling — grayed by group exclusion
  });

  it('clicking an option disables its unchecked siblings while the write is in flight', async () => {
    let release: (ok: boolean) => void = () => {};
    const gate = new Promise<boolean>((r) => {
      release = r;
    });
    const actions = makeActions(() => gate);
    const root = open(makeTask(), BODY, actions);
    const btns = groupButtons(root, 'D1');
    expect(btns.map((b) => b.disabled)).toEqual([false, false]); // open group starts enabled

    for (const fn of btns[0].listeners.click ?? []) fn(); // pick 方案A
    expect(actions.calls.resolveDecision).toEqual([['a.md', 'D1', '方案A']]);
    // Before the write settles, EVERY button in the group is locked.
    expect(btns[0].disabled).toBe(true);
    expect(btns[1].disabled).toBe(true);
    // D2 is a different group — untouched.
    expect(groupButtons(root, 'D2').map((b) => b.disabled)).toEqual([false]);

    release(true); // success → re-render reads the live body
    await gate;
    await Promise.resolve();
  });

  it('a failed write re-enables the group on re-render (live body unchanged)', async () => {
    const actions = makeActions(() => Promise.resolve(false));
    const root = open(makeTask(), BODY, actions);
    const btns = groupButtons(root, 'D1');
    for (const fn of btns[0].listeners.click ?? []) fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.calls.resolveDecision).toHaveLength(1);
    // Re-render happened (contentEl rebuilt from the same body) — group is open again.
    expect(groupButtons(root, 'D1').map((b) => b.disabled)).toEqual([false, false]);
  });

  it('a successful write re-renders with the group settled from the updated body', async () => {
    let body = BODY;
    const actions = makeActions(async (group, label) => {
      // Minimal in-memory flip the way applyDecision would write it.
      body = body.replace(`- [ ] ${group} ${label}`, `- [x] ${group} ${label} ✅ 2026-08-25`);
      return true;
    });
    const store = {
      entryByPath: () => ({ task: makeTask(), body, error: undefined }) as unknown as Entry,
    } as unknown as TaskStore;
    openDetail({ vault: { getName: () => 'vault', adapter: {} } } as never, store, actions as never, 'a.md', T_ZH);
    const modal = Modal.instances[Modal.instances.length - 1] as unknown as { onOpen(): void; contentEl: any };
    modal.onOpen();
    const btns = groupButtons(modal.contentEl, 'D1');
    for (const fn of btns[1].listeners.click ?? []) fn(); // pick 方案B
    await Promise.resolve();
    await Promise.resolve();
    // The re-rendered panel reads the flipped body: both D1 options disabled, B checked.
    const after = groupButtons(modal.contentEl, 'D1');
    expect(after.map((b) => b.disabled)).toEqual([true, true]);
    expect(after[1].text).toContain('方案B ✅');
  });
});

// The fake contentEl must be importable and shaped like the stub contract (smoke).
describe('stub sanity', () => {
  it('mkFakeEl builds nested trees with classes and listeners', () => {
    const el = mkFakeEl();
    const child = el.createDiv({ cls: 'a b', text: 'hi' });
    child.addEventListener('click', () => {});
    expect(child.classes).toEqual(['a', 'b']);
    expect(child.listeners.click).toHaveLength(1);
    el.empty();
    expect(el.children).toEqual([]);
  });
});
