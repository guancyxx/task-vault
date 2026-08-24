// FR-048 audit follow-up: the `session` frontmatter key MUST survive parseTaskFile —
// the hook writes it, and hookRunner.var() reads task.session to build {TASK_SESSION}.
// The author's tests hand-built Task objects, bypassing the parser, which is exactly
// how the whitelist gap slipped through (audit Required finding on PR #34).
import { describe, expect, it } from 'vitest';
import { parseTaskFile } from '../src/util/frontmatter';

const RAW = [
  '---',
  'id: 11111111-2222-3333-4444-555555555555',
  'title: probe',
  'status: doing',
  'created: 2026-08-25T08:00',
  'assignee: cc',
  'dispatched: 2026-08-25T08:01',
  'session: sess-abc-123',
  '---',
  '',
  '## 任务描述',
  '',
  'body',
  '',
].join('\n');

describe('FR-048 session field round-trip through parseTaskFile', () => {
  it('keeps session when present', () => {
    const p = parseTaskFile(RAW, '03 Tasks/x/probe.md');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.task.session).toBe('sess-abc-123');
  });

  it('leaves session undefined when absent (cold start)', () => {
    const p = parseTaskFile(RAW.replace('session: sess-abc-123\n', ''), '03 Tasks/x/probe.md');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.task.session).toBeUndefined();
  });
});
