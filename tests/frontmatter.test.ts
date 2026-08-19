import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/model/types';
import {
  atomicWrite,
  getSection,
  parseTaskFile,
  serializeTaskFile,
  upsertSection,
  type FileSystem,
} from '../src/util/frontmatter';

function ok(result: ReturnType<typeof parseTaskFile>) {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result;
}

describe('serialize/parse round-trip (FR-001)', () => {
  it('preserves the full schema', () => {
    const task: Task = {
      id: 'A1B2-C3D4',
      title: 'ship task-vault: phase A #build',
      status: 'doing',
      start: '2026-08-20',
      due: '2026-08-25T14:30',
      remind: '30m',
      created: '2026-08-19T09:00',
      started: '2026-08-19T10:00',
      priority: 'high',
      source: 'user',
      assignee: 'cc',
      dispatched: '2026-08-19T11:00',
      project: 'Task Vault',
      area: 'Dev',
      parent: 'PARENT-ID',
      'blocked-by': ['DEP-1', 'DEP-2'],
      tags: ['build', 'phase-a'],
      mirror: { 'reminders-uuid': 'ABCD1234-5678-90AB-CDEF-1234567890AB' },
    };
    const body = '## 执行记录\n- 2026-08-19 10:00 [cc] [todo→doing] started\n';
    const round = ok(parseTaskFile(serializeTaskFile(task, body), 'x.md'));
    expect(round.task).toEqual(task);
    expect(round.body).toBe(body);
  });

  it('keeps date vs datetime granularity distinct', () => {
    const allDay: Task = { id: 'i', title: 't', status: 'todo', created: '2026-08-19T09:00', due: '2026-08-25' };
    const timed: Task = { id: 'i', title: 't', status: 'todo', created: '2026-08-19T09:00', due: '2026-08-25T14:30' };
    expect(ok(parseTaskFile(serializeTaskFile(allDay, ''), 'x.md')).task.due).toBe('2026-08-25');
    expect(ok(parseTaskFile(serializeTaskFile(timed, ''), 'x.md')).task.due).toBe('2026-08-25T14:30');
  });

  it('tolerates missing optional fields', () => {
    const minimal: Task = { id: 'i', title: 't', status: 'inbox', created: '2026-08-19T09:00' };
    const round = ok(parseTaskFile(serializeTaskFile(minimal, ''), 'x.md'));
    expect(round.task).toEqual(minimal);
    expect(round.task.due).toBeUndefined();
  });

  it('round-trips titles with colons and quotes', () => {
    const task: Task = { id: 'i', title: 'fix: the "hard" bug', status: 'todo', created: '2026-08-19T09:00' };
    expect(ok(parseTaskFile(serializeTaskFile(task, ''), 'x.md')).task.title).toBe('fix: the "hard" bug');
  });
});

describe('fault tolerance with file location', () => {
  it('reports an error (not throw) for missing frontmatter', () => {
    const r = parseTaskFile('no frontmatter here', 'bad.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('bad.md');
  });

  it('reports an invalid status with file location', () => {
    const raw = '---\nid: i\ntitle: t\nstatus: dooing\ncreated: 2026-08-19T09:00\n---\n';
    const r = parseTaskFile(raw, 'weird.md');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('weird.md');
      expect(r.error).toContain('status');
    }
  });

  it('reports an invalid due format', () => {
    const raw = '---\nid: i\ntitle: t\nstatus: todo\ncreated: 2026-08-19T09:00\ndue: 25/08/2026\n---\n';
    const r = parseTaskFile(raw, 'weird.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('due');
  });

  it('reports missing required id', () => {
    const raw = '---\ntitle: t\nstatus: todo\ncreated: 2026-08-19T09:00\n---\n';
    const r = parseTaskFile(raw, 'weird.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('id');
  });
});

describe('body section splitting (FR-018)', () => {
  const body = 'intro line\n\n## 执行记录\n- a\n- b\n\n## 委派\nassignee note\n';

  it('extracts a section by heading', () => {
    expect(getSection(body, '## 执行记录')).toBe('- a\n- b');
    expect(getSection(body, '## 委派')).toBe('assignee note');
    expect(getSection(body, '## 缺失')).toBeNull();
  });

  it('replaces an existing section without touching others', () => {
    const next = upsertSection(body, '## 执行记录', '- a\n- b\n- c');
    expect(getSection(next, '## 执行记录')).toBe('- a\n- b\n- c');
    expect(getSection(next, '## 委派')).toBe('assignee note');
  });

  it('creates a missing section', () => {
    const next = upsertSection('just intro\n', '## 执行记录', '- first');
    expect(getSection(next, '## 执行记录')).toBe('- first');
    expect(next).toContain('just intro');
  });
});

describe('atomic write (temp + rename)', () => {
  it('writes a temp file then renames over the target', async () => {
    const calls: string[] = [];
    const fs: FileSystem = {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async (p: string) => { calls.push(`write:${p}`); }),
      rename: vi.fn(async (from: string, to: string) => { calls.push(`rename:${from}->${to}`); }),
    };
    await atomicWrite(fs, '/vault/03 Tasks/a.md', 'data');
    expect(calls).toEqual([
      'write:/vault/03 Tasks/a.md.tmp',
      'rename:/vault/03 Tasks/a.md.tmp->/vault/03 Tasks/a.md',
    ]);
  });
});
