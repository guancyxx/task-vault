import { describe, expect, it } from 'vitest';
import { applyReviewGate, shouldGuardExternalDone } from '../src/store/reviewGate';
import type { Task } from '../src/model/types';

const NOW = new Date(2026, 7, 19, 14, 32);

function doneTask(extra: Partial<Task> = {}): Task {
  return {
    id: 'gated',
    title: 'gated',
    status: 'done',
    created: '2026-08-19T09:00',
    assignee: 'cc',
    completed: '2026-08-19T14:30',
    ...extra,
  };
}

describe('external done review gate (FR-030)', () => {
  it('guards an agent-authored done without user confirmation', () => {
    const body = '## 执行记录\n\n- 2026-08-19 14:30 · **doing→done** · `cc`\n  完成\n';
    expect(shouldGuardExternalDone('doing', doneTask(), body)).toBe(true);
    const guarded = applyReviewGate(doneTask(), body, NOW);
    expect(guarded.task.status).toBe('review');
    expect(guarded.task.completed).toBeUndefined();
    expect(guarded.body).toContain('**done→review** · `hermes`');
    expect(guarded.body).toContain('复核门禁');
  });

  it('allows explicit user and Reminders confirmation channels', () => {
    const user = '## 执行记录\n\n- 2026-08-19 14:30 · **doing→done** · `user`\n  确认\n';
    const reminders = '## 执行记录\n\n- 2026-08-19 14:30 · `codex`\n  Reminders 里勾了完成\n';
    expect(shouldGuardExternalDone('doing', doneTask(), user)).toBe(false);
    expect(shouldGuardExternalDone('review', doneTask(), reminders)).toBe(false);
  });
});

describe('chat-confirmation citation channel (FR-030a)', () => {
  const cite = (where: 'done-entry' | 'later-entry') => {
    const line = 'user-confirm: session=20260823_064634_c34e81 msg=64200 quote="做"';
    if (where === 'done-entry') {
      return `## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · \`hermes\`\n  用户在聊天里确认了\n  ${line}\n`;
    }
    // 倒序区：更晚的条目写在更上面
    return (
      `## 执行记录\n\n- 2026-08-23 07:12 · \`hermes\`\n  ${line}\n` +
      '- 2026-08-23 07:10 · **review→done** · `hermes`\n  收尾\n'
    );
  };

  it('accepts a citation inside the done entry', () => {
    expect(shouldGuardExternalDone('review', doneTask(), cite('done-entry'))).toBe(false);
  });

  it('accepts a citation in a chronologically-later entry (newest-first log)', () => {
    expect(shouldGuardExternalDone('review', doneTask(), cite('later-entry'))).toBe(false);
  });

  it('rejects a malformed citation and plain prose claims', () => {
    const malformed = '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  user-confirm: session=x msg=abc quote="做"\n';
    expect(shouldGuardExternalDone('review', doneTask(), malformed)).toBe(true);
    const prose = '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  用户说做，我就做了\n';
    expect(shouldGuardExternalDone('review', doneTask(), prose)).toBe(true);
  });

  it('rejects a citation that predates the done edge', () => {
    // 倒序区：更早的条目写在 done 条目下面，不算确认
    const body =
      '- 2026-08-23 07:10 · **review→done** · `hermes`\n  收尾\n' +
      '- 2026-08-23 06:00 · `hermes`\n  user-confirm: session=20260823_064634_c34e81 msg=64200 quote="做"\n';
    const wrapped = `## 执行记录\n\n${body}`;
    expect(shouldGuardExternalDone('review', doneTask(), wrapped)).toBe(true);
  });
});

describe('already-gated loop guard', () => {
  it('disarms only on the gate marker line, not prose mentioning the gate', () => {
    const prose = '## 执行记录\n\n- 2026-08-23 07:10 · **doing→done** · `hermes`\n  复核门禁这词我提过了\n';
    expect(shouldGuardExternalDone('doing', doneTask(), prose)).toBe(true);
    const marker = '复核门禁：拦截 agent 直接置 done，转待复核（FR-030）';
    expect(shouldGuardExternalDone('doing', doneTask(), `## 执行记录\n\n- x\n  ${marker}\n`)).toBe(false);
  });
});
