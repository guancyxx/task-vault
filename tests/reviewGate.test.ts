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
    // Reminders 同步器落的真实形态：done 边 + 标记在同一条目（_record_transition）
    const reminders =
      '## 执行记录\n\n- 2026-08-19 14:30 · **doing→done** · `codex`\n  Reminders 里勾了完成，同步器落的状态\n';
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

  it('accepts an externally-written doing→done whose citation landed first (FR-030a lock order)', () => {
    // Correct lock order: body (done edge + citation) patched BEFORE the frontmatter
    // status flip, so by the time the gate ingests the upsert the citation is already
    // there. This is the original incident shape (2026-08-24) — from=doing, not review.
    expect(shouldGuardExternalDone('doing', doneTask(), cite('done-entry'))).toBe(false);
  });

  it('accepts a citation in a chronologically-later entry (newest-first log)', () => {
    expect(shouldGuardExternalDone('review', doneTask(), cite('later-entry'))).toBe(false);
  });

  it('accepts an escaped-quote citation', () => {
    const body =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n' +
      '  user-confirm: session=s msg=1 quote="他说 \\"做\\""\n';
    expect(shouldGuardExternalDone('review', doneTask(), body)).toBe(false);
  });

  it('rejects malformed / empty-quote citations and plain prose claims', () => {
    const malformed =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  user-confirm: session=x msg=abc quote="做"\n';
    expect(shouldGuardExternalDone('review', doneTask(), malformed)).toBe(true);
    const empty =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  user-confirm: session=x msg=1 quote=""\n';
    expect(shouldGuardExternalDone('review', doneTask(), empty)).toBe(true);
    const prose =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  用户说做，我就做了\n';
    expect(shouldGuardExternalDone('review', doneTask(), prose)).toBe(true);
  });

  it('rejects citations carrying prefix/trailing junk on the line (audit R1 closure)', () => {
    const prefix =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  xx user-confirm: session=s msg=1 quote="做"\n';
    expect(shouldGuardExternalDone('review', doneTask(), prefix)).toBe(true);
    const trailing =
      '## 执行记录\n\n- 2026-08-23 07:10 · **review→done** · `hermes`\n  user-confirm: session=s msg=1 quote="做" trailing\n';
    expect(shouldGuardExternalDone('review', doneTask(), trailing)).toBe(true);
  });

  it('does not accept citations when the log has no done edge (audit C2)', () => {
    const body =
      '## 执行记录\n\n- 2026-08-23 07:00 · `hermes`\n  user-confirm: session=20260823_064634_c34e81 msg=64200 quote="做"\n';
    expect(shouldGuardExternalDone('doing', doneTask(), body)).toBe(true);
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

describe('window and actor alignment (audit R2)', () => {
  it('judges Reminders marker only inside the at-or-after-done window', () => {
    // 旧标记在 done 边之前（倒序区更靠后）→ 不算确认
    const old =
      '- 2026-08-23 07:10 · **review→done** · `hermes`\n  x\n' +
      '- 2026-08-23 06:00 · `codex`\n  Reminders 里勾了完成\n';
    expect(shouldGuardExternalDone('review', doneTask(), `## 执行记录\n\n${old}`)).toBe(true);
  });

  it('judges user actor from the canonical headline only, not prose continuations', () => {
    const prose =
      '- 2026-08-23 07:12 · `hermes`\n  用户说了 · `user` 这样的话\n' +
      '- 2026-08-23 07:10 · **review→done** · `hermes`\n  x\n';
    expect(shouldGuardExternalDone('review', doneTask(), `## 执行记录\n\n${prose}`)).toBe(true);
    const canonical =
      '- 2026-08-23 07:12 · **review→done** · `user`\n  确认\n' +
      '- 2026-08-23 07:10 · **review→done** · `hermes`\n  x\n';
    expect(shouldGuardExternalDone('review', doneTask(), `## 执行记录\n\n${canonical}`)).toBe(false);
  });
});

describe('already-gated loop guard (audit R5)', () => {
  const MARKER = '复核门禁：拦截 agent 直接置 done，转待复核（FR-030）';

  it('disarms on the gate\'s own canonical entry (done→review by hermes carrying the marker)', () => {
    const gated = applyReviewGate(doneTask(), '## 执行记录\n\n- a\n  b\n', NOW).body;
    expect(shouldGuardExternalDone('doing', doneTask(), gated)).toBe(false);
  });

  it('stays armed when the marker sentence appears in prose or a non-gate entry', () => {
    const prose = `## 执行记录\n\n- 2026-08-23 07:10 · **doing→done** · \`hermes\`\n  ${MARKER}\n`;
    expect(shouldGuardExternalDone('doing', doneTask(), prose)).toBe(true);
    const wrongActor = `## 执行记录\n\n- 2026-08-23 07:10 · **done→review** · \`cc\`\n  ${MARKER}\n`;
    expect(shouldGuardExternalDone('doing', doneTask(), wrongActor)).toBe(true);
  });
});
