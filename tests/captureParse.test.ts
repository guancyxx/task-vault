import { describe, expect, it } from 'vitest';
import {
  captureToTask,
  parseCapture,
  resolveTaskPath,
  slugify,
} from '../src/view/captureParse';

const NOW = new Date(2026, 7, 19, 14, 32); // 2026-08-19 14:32 Wed

describe('parseCapture — syntax extraction + stripping (FR-010)', () => {
  it('plain title → inbox-bound, no metadata', () => {
    const c = parseCapture('买牛奶', NOW);
    expect(c).toEqual({ title: '买牛奶' });
  });

  it('extracts !priority / @project / #tags and strips them from the title', () => {
    const c = parseCapture('!high 交报告 @工作 #ddl #urgent', NOW);
    expect(c).toMatchObject({
      title: '交报告',
      priority: 'high',
      project: '工作',
      tags: ['ddl', 'urgent'],
    });
    expect(c!.due).toBeUndefined();
    expect(c!.title).not.toContain('!');
    expect(c!.title).not.toContain('@');
    expect(c!.title).not.toContain('#');
  });

  it('accepts !normal and !low', () => {
    expect(parseCapture('!normal x', NOW)!.priority).toBe('normal');
    expect(parseCapture('!low x', NOW)!.priority).toBe('low');
  });

  it('wires in NL date (date-only)', () => {
    const c = parseCapture('明天 交报告', NOW);
    expect(c).toMatchObject({ title: '交报告', due: '2026-08-20', dueIsDateTime: false });
  });

  it('wires in NL date (timed)', () => {
    const c = parseCapture('明天下午3点 开会', NOW);
    expect(c).toMatchObject({ title: '开会', due: '2026-08-20T15:00', dueIsDateTime: true });
  });

  it('captures a reminder offset alongside the due', () => {
    const c = parseCapture('提前30分钟提醒 明早9点 吃药', NOW);
    expect(c).toMatchObject({ title: '吃药', due: '2026-08-20T09:00', remind: '30m' });
  });

  it('rejects an empty or metadata-only title', () => {
    expect(parseCapture('   ', NOW)).toBeNull();
    expect(parseCapture('!high @x #y', NOW)).toBeNull();
  });
});

describe('slugify (contract §5)', () => {
  it('keeps CJK verbatim', () => expect(slugify('买牛奶')).toBe('买牛奶'));
  it('lowercases, spaces → -, drops punctuation', () =>
    expect(slugify('Fix the Bug!')).toBe('fix-the-bug'));
  it('collapses runs and trims dashes', () =>
    expect(slugify('  多个   空格 ')).toBe('多个-空格'));
  it('empty → task', () => expect(slugify('')).toBe('task'));
  it('truncates to 50 chars', () => expect(slugify('a'.repeat(80)).length).toBe(50));
});

describe('captureToTask', () => {
  it('no due → todo + today-22:00 DDL; with due → todo; sets identity fields', () => {
    const inbox = captureToTask({ title: '买牛奶' }, { id: 'uuid-1', now: NOW });
    expect(inbox).toMatchObject({ id: 'uuid-1', title: '买牛奶', status: 'todo', source: 'user', created: '2026-08-19T14:32', due: '2026-08-19T22:00' });

    const todo = captureToTask(
      { title: '交报告', due: '2026-08-20', dueIsDateTime: false, priority: 'high', project: '工作', tags: ['ddl'] },
      { id: 'uuid-2', now: NOW },
    );
    expect(todo).toMatchObject({ status: 'todo', due: '2026-08-20', priority: 'high', project: '工作', tags: ['ddl'] });
  });
});

describe('resolveTaskPath (contract §5 — conflict suffixes)', () => {
  it('bare path when free', () => {
    expect(resolveTaskPath('03 Tasks', '2026-08-19', '买牛奶', () => false)).toBe(
      '03 Tasks/2026-08-19-买牛奶.md',
    );
  });
  it('appends -2 / -3 on collision', () => {
    const taken = new Set(['03 Tasks/2026-08-19-x.md', '03 Tasks/2026-08-19-x-2.md']);
    expect(resolveTaskPath('03 Tasks', '2026-08-19', 'x', (p) => taken.has(p))).toBe(
      '03 Tasks/2026-08-19-x-3.md',
    );
  });
});
