import { describe, expect, it } from 'vitest';
import { STATUSES } from '../src/model/types';
import { STATUS_LABEL, STATUS_META, statusTooltip } from '../src/view/taskRow';

describe('statusTooltip (FR-031 row tooltip)', () => {
  it('formats 状态：<label>（<status>）', () => {
    expect(statusTooltip('doing')).toBe('状态：进行中（doing）');
    expect(statusTooltip('cancelled')).toBe('状态：已取消（cancelled）');
    expect(statusTooltip('inbox')).toBe('状态：收件箱（inbox）');
  });

  it('covers every status from the single label source (no drift)', () => {
    for (const s of STATUSES) {
      expect(statusTooltip(s)).toBe(`状态：${STATUS_LABEL[s]}（${s}）`);
    }
  });
});

describe('STATUS_META (row/legend shared seed)', () => {
  it('has a glyph + color class for every status', () => {
    for (const s of STATUSES) {
      expect(STATUS_META[s]?.cls).toBeTruthy();
      expect(STATUS_META[s]?.glyph).toBeTruthy();
    }
  });
});
