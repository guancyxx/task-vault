import { describe, expect, it } from 'vitest';
import { agentProgress, parseLogEntries } from '../src/model/agentProgress';
import type { Task } from '../src/model/types';

function task(extra: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'agent task',
    status: 'todo',
    created: '2026-08-19T09:00',
    assignee: 'cc',
    ...extra,
  };
}

function log(...lines: string[]): string {
  return `## 执行记录\n\n${lines.join('\n')}\n`;
}

describe('agentProgress (FR-028)', () => {
  it('derives dispatched before an agent accepts', () => {
    expect(agentProgress(task({ dispatched: '2026-08-19T10:00' }), log())).toEqual({ phase: 'dispatched' });
  });

  it('derives working and exposes the newest activity timestamp', () => {
    const body = log('- 2026-08-19 11:00 · **todo→doing** · `cc`', '  接单：开始执行');
    expect(parseLogEntries(body)).toHaveLength(1);
    expect(agentProgress(task({ status: 'doing' }), body)).toEqual({
      phase: 'working',
      lastActivity: '2026-08-19 11:00',
    });
  });

  it('derives stuck when the newest entry is a blocker', () => {
    const body = log(
      '- 2026-08-19 12:00 · **卡点** · `cc`',
      '  卡点：缺权限',
      '',
      '- 2026-08-19 11:00 · `cc`',
      '  接单：开始执行',
    );
    expect(agentProgress(task({ status: 'doing' }), body)).toEqual({
      phase: 'stuck',
      lastActivity: '2026-08-19 12:00',
    });
  });

  it('derives review from the gated task status', () => {
    expect(agentProgress(task({ status: 'review' }), log())).toEqual({ phase: 'review' });
  });

  it('returns null for user-owned tasks', () => {
    expect(agentProgress(task({ status: 'doing', assignee: 'user' }), log())).toBeNull();
  });
});
