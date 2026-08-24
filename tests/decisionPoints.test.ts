import { describe, expect, it } from 'vitest';
// FR-050 decision-point parser: pure tolerant parsing of the `## 决策点` section.
// Mirrors agentProgress's philosophy — a malformed line must never sink the sidebar scan.
import {
  applyDecision,
  checkLine,
  DECISION_HEADING,
  decisionLogText,
  groupDecisionPoints,
  openDecisionGroupCount,
  openDecisionPoints,
  parseDecisionPoints,
  stampDate,
} from '../src/model/decisionPoints';

const BODY = [
  '---',
  'id: t1',
  '---',
  'Intro prose the parser must ignore.',
  '',
  '## 决策点',
  '- [ ] D1 方案A：本地缓存',
  '- [ ] D1 方案B：直连远端',
  '- [x] D2 保持现状 ✅ 2026-08-24',
  '',
  'garbage line without a checkbox',
  '',
  '## 执行记录',
  '- 2026-08-24 09:00 · `user`',
  '  earlier log',
].join('\n');

describe('parseDecisionPoints (FR-050 parser)', () => {
  it('parses options with group, label, checked, and section-scoped lineIndex', () => {
    const opts = parseDecisionPoints(BODY);
    // The garbage line is skipped; entries after the next `## ` heading are out of section.
    expect(opts).toHaveLength(3);
    expect(opts[0]).toMatchObject({ group: 'D1', label: '方案A：本地缓存', checked: false, lineIndex: 6 });
    expect(opts[1]).toMatchObject({ group: 'D1', label: '方案B：直连远端', checked: false });
    expect(opts[2]).toMatchObject({ group: 'D2', label: '保持现状', checked: true, decidedAt: '2026-08-24' });
  });

  it('returns [] for a body without the section (tolerant, never throws)', () => {
    expect(parseDecisionPoints('no sections here')).toEqual([]);
    expect(parseDecisionPoints('')).toEqual([]);
  });

  it('accepts uppercase X as checked and parses the trailing ✅ date stamp', () => {
    const body = ['## 决策点', '- [X] D3 采用灰度 ✅ 2026-01-02'].join('\n');
    const [o] = parseDecisionPoints(body);
    expect(o.checked).toBe(true);
    expect(o.decidedAt).toBe('2026-01-02');
    expect(o.label).toBe('采用灰度');
  });

  it('skips malformed lines silently (bad lines do not throw or emit)', () => {
    const body = [
      DECISION_HEADING,
      '- [ ] D1 ok option',
      '- [x]missing space',
      '- D1 no checkbox',
      'random prose',
      '- [ ] no-group option',
      '- [ ] D99ok',
    ].join('\n');
    const opts = parseDecisionPoints(body);
    expect(opts.map((o) => o.label)).toEqual(['ok option']);
    expect(opts[0].group).toBe('D1');
  });

  it('groups options sharing a Dn prefix, preserving section order', () => {
    const groups = groupDecisionPoints(parseDecisionPoints(BODY));
    expect(groups.map((g) => g.group)).toEqual(['D1', 'D2']);
    expect(groups[0].options.map((o) => o.label)).toEqual(['方案A：本地缓存', '方案B：直连远端']);
  });

  it('openDecisionPoints / openDecisionGroupCount expose only the undecided work', () => {
    expect(openDecisionPoints(BODY)).toHaveLength(2); // both D1 options; D2 is settled
    expect(openDecisionGroupCount(BODY)).toBe(1); // one decision = one group
    const allDone = ['## 决策点', '- [x] D1 甲 ✅ 2026-08-01', '- [x] D2 乙 ✅ 2026-08-01'].join('\n');
    expect(openDecisionGroupCount(allDone)).toBe(0);
  });
});

describe('applyDecision / checkLine (FR-050 write path)', () => {
  it('flips exactly the target line to checked + ✅ date, leaving siblings byte-identical', () => {
    const next = applyDecision(BODY, 'D1', '方案B：直连远端', '2026-08-25');
    expect(next).not.toBeNull();
    const lines = next!.split('\n');
    expect(lines[7]).toBe('- [x] D1 方案B：直连远端 ✅ 2026-08-25');
    expect(lines[6]).toBe('- [ ] D1 方案A：本地缓存'); // sibling untouched
    expect(lines[8]).toBe('- [x] D2 保持现状 ✅ 2026-08-24'); // settled history untouched
    // Everything outside the target line is identical.
    const before = BODY.split('\n');
    expect(lines.filter((_, i) => i !== 7)).toEqual(before.filter((_, i) => i !== 7));
  });

  it('refuses a second decision on the same option (null, no rewrite of settled lines)', () => {
    expect(applyDecision(BODY, 'D2', '保持现状', '2026-08-25')).toBeNull();
  });

  it('returns null for unknown group/label (file drift safety)', () => {
    expect(applyDecision(BODY, 'D9', 'nope', '2026-08-25')).toBeNull();
    expect(applyDecision(BODY, 'D1', 'nope', '2026-08-25')).toBeNull();
  });

  it('checkLine rejects malformed and already-checked lines', () => {
    expect(checkLine('- [ ] D1 甲', '2026-08-25')).toBe('- [x] D1 甲 ✅ 2026-08-25');
    expect(checkLine('- [x] D1 甲 ✅ 2026-08-24', '2026-08-25')).toBeNull();
    expect(checkLine('not a decision line', '2026-08-25')).toBeNull();
  });

  it('stampDate formats local YYYY-MM-DD with zero padding; decisionLogText joins Dn + label', () => {
    expect(stampDate(new Date(2026, 7, 25))).toBe('2026-08-25'); // month is 0-based
    expect(stampDate(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(decisionLogText('D1', '方案B：直连远端')).toBe('D1 方案B：直连远端');
  });
});
