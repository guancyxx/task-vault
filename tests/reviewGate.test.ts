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
