// FR-048 plugin-side tests: delegation round-append format, {TASK_SESSION} substitution,
// and the resume-mode delegate panel (badge + follow-up seed).

import { describe, expect, it } from 'vitest';
import { appendDelegationRound, getSection, parseRoundHeads } from '../src/util/frontmatter';
import { DEFAULT_CONFIG } from '../src/config';
import { EMPTY_LEDGER, HookRunner, type HookExec, type Ledger } from '../src/hooks/hookRunner';
import type { JsonStore } from '../src/store/jsonStore';
import type { Task } from '../src/model/types';
import { createT } from '../src/i18n';

// ---- round append (pure) ----

const H = '## 委派';
const D1 = new Date(2026, 7, 24, 10, 0); // 2026-08-24
const D2 = new Date(2026, 7, 25, 9, 30); // 2026-08-25

describe('appendDelegationRound (FR-048)', () => {
  it('creates the section with a 第1轮 header on first delegation', () => {
    const out = appendDelegationRound('intro text\n', H, '修一下登录', D1);
    const sec = getSection(out, H);
    expect(sec).toBe('### 第1轮 2026-08-24\n修一下登录');
    expect(parseRoundHeads(out, H)).toEqual([{ n: 1, line: 3 }]);
    expect(out).toContain('intro text');
  });

  it('second round goes on top; round 1 stays verbatim and both headers parse', () => {
    const first = appendDelegationRound('intro\n', H, '修一下登录', D1);
    const second = appendDelegationRound(first, H, '针对上次产出，补充意见：边界情况没覆盖', D2);
    const sec = getSection(second, H);
    // Newest first, one blank line between rounds, prior round untouched.
    expect(sec).toBe('### 第2轮 2026-08-25\n针对上次产出，补充意见：边界情况没覆盖\n\n### 第1轮 2026-08-24\n修一下登录');
    const heads = parseRoundHeads(second, H);
    expect(heads.map((h) => h.n)).toEqual([2, 1]);
  });

  it('round numbering continues from max even across further rounds', () => {
    let body = 'x\n';
    for (let i = 1; i <= 3; i++) body = appendDelegationRound(body, H, `r${i}`, D1);
    const heads = parseRoundHeads(body, H);
    expect(heads.map((h) => h.n)).toEqual([3, 2, 1]);
    expect(getSection(body, H)).toContain('### 第1轮');
    expect(getSection(body, H)).toContain('r1');
  });

  it('a legacy un-roundified delegation body is preserved as the tail of round 1', () => {
    const legacy = 'old-style body\n\n## 委派\n原始指令全文\n';
    const out = appendDelegationRound(legacy, H, '第二轮指令', D2);
    const sec = getSection(out, H);
    expect(sec).toBe('### 第1轮 2026-08-25\n第二轮指令\n\n原始指令全文');
  });

  it('leaves other sections (## 执行记录) untouched', () => {
    const withLog = '## 委派\n\n### 第1轮 2026-08-24\nfirst\n\n## 执行记录\n\n- 2026-08-24 10:00 · `user`\n  委派给 cc\n';
    const out = appendDelegationRound(withLog, H, 'next', D2);
    expect(getSection(out, '## 执行记录')).toBe('- 2026-08-24 10:00 · `user`\n  委派给 cc');
    expect(getSection(out, H)).toContain('### 第2轮');
    expect(getSection(out, H)).toContain('first');
  });
});

// ---- TASK_SESSION substitution ----

function memLedger(): { store: JsonStore<Ledger> } {
  let cur: Ledger = JSON.parse(JSON.stringify(EMPTY_LEDGER));
  return {
    store: {
      read: async () => JSON.parse(JSON.stringify(cur)),
      write: async (v) => {
        cur = JSON.parse(JSON.stringify(v));
      },
    },
  };
}

function recExec(): { exec: HookExec; calls: Array<{ cmd: string; env: Record<string, string> }> } {
  const calls: Array<{ cmd: string; env: Record<string, string> }> = [];
  return {
    calls,
    exec: {
      async run(cmd, env) {
        calls.push({ cmd, env });
      },
    },
  };
}

function mkTask(over: Partial<Task> = {}): Task {
  return { id: 'id-1', title: '写周报', status: 'todo', created: '2026-08-19T10:00', ...over };
}

describe('{TASK_SESSION} (FR-048)', () => {
  const mkRunner = (exec: HookExec): HookRunner =>
    new HookRunner({
      config: () => ({ ...DEFAULT_CONFIG, dispatch_hook: 'go "{TASK_SESSION}"' }),
      ledger: memLedger().store,
      exec,
      now: () => new Date(2026, 7, 25, 9, 0),
    });

  it('substitutes task.session and sets TV_TASK_SESSION when present', async () => {
    const { exec, calls } = recExec();
    await mkRunner(exec).fireDispatch(mkTask({ session: 'sess-abc' }), 'p.md', 'do it');
    expect(calls[0].cmd).toBe('go "sess-abc"');
    expect(calls[0].env.TV_TASK_SESSION).toBe('sess-abc');
  });

  it('substitutes an empty string (cold start) when session is absent', async () => {
    const { exec, calls } = recExec();
    await mkRunner(exec).fireDispatch(mkTask(), 'p.md', 'do it');
    expect(calls[0].cmd).toBe('go ""');
    expect(calls[0].env.TV_TASK_SESSION).toBe('');
  });
});

// ---- delegate panel resume mode ----

// Minimal DOM doubles: renderDelegatePanel only uses createDiv/createEl + addEventListener.
// Every created element is also recorded in a shared flat list, so lookups don't depend on the
// (irrelevant for the assertion) parent/child nesting the real DOM would have.
class FakeEl {
  cls = '';
  text = '';
  value = '';
  children: FakeEl[] = [];
  constructor(private all: FakeEl[] = []) {
    this.all.push(this);
  }
  createDiv(o: { cls?: string; text?: string }): FakeEl {
    return this.mk(o);
  }
  createEl(_tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
    return this.mk(o);
  }
  private mk(o?: { cls?: string; text?: string }): FakeEl {
    const el = new FakeEl(this.all);
    el.cls = o?.cls ?? '';
    el.text = o?.text ?? '';
    this.children.push(el);
    return el;
  }
  addEventListener(_evt: string, _fn: () => void): void {}
}

function renderInto(mod: typeof import('../src/view/delegatePanel'), opts: import('../src/view/delegatePanel').DelegatePanelOpts): FakeEl[] {
  const all: FakeEl[] = [];
  const body = new FakeEl(all);
  mod.renderDelegatePanel(body as unknown as HTMLElement, createT('zh-CN'), opts);
  return all;
}

describe('delegatePanel resume seed (FR-048)', () => {
  it('RESUME_SEED_ZH is the exact follow-up prefix from the spec', async () => {
    const mod = await import('../src/view/delegatePanel');
    expect(mod.RESUME_SEED_ZH).toBe('针对上次产出，补充意见：');
  });

  it('dispatched task with no draft instruction gets the follow-up seed', async () => {
    const mod = await import('../src/view/delegatePanel');
    const all = renderInto(mod, { instruction: '', dispatched: true, onSubmit: () => {} });
    const badge = all.find((c) => c.cls === 'tv-delegate-resume');
    expect(badge?.text).toContain('续接会话');
    const seeded = all.filter((c) => c.value !== '').map((c) => c.value);
    expect(seeded).toEqual([mod.RESUME_SEED_ZH]);
  });

  it('undispatched task gets neither badge nor seed', async () => {
    const mod = await import('../src/view/delegatePanel');
    const all = renderInto(mod, { instruction: '', onSubmit: () => {} });
    expect(all.find((c) => c.cls === 'tv-delegate-resume')).toBeUndefined();
    expect(all.some((c) => c.value === mod.RESUME_SEED_ZH)).toBe(false);
  });

  it('a user-typed draft wins over the seed on re-render', async () => {
    const mod = await import('../src/view/delegatePanel');
    const all = renderInto(mod, { instruction: '我自己的草稿', dispatched: true, onSubmit: () => {} });
    expect(all.find((c) => c.cls === 'tv-delegate-resume')).toBeDefined();
    const seeded = all.filter((c) => c.value !== '').map((c) => c.value);
    expect(seeded).toEqual(['我自己的草稿']);
  });
});
