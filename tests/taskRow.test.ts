import { describe, expect, it } from 'vitest';
import { STATUSES } from '../src/model/types';
import { STATUS_LABEL, STATUS_META, priorityChip, statusTooltip } from '../src/view/taskRow';

// FR-046 row de-noise: only p0 (high) is a resident triage signal on the title row; p1/p2/p3 drop
// to the hover layer. priorityChip is the single source the render reads for this placement.
describe('priorityChip (FR-046 resident vs hover priority)', () => {
  it('marks only p0 (high) resident; p1/p2/p3 are hover-only', () => {
    expect(priorityChip({ priority: 'high' })).toEqual({ tag: 'p0', resident: true });
    expect(priorityChip({ priority: 'normal' })).toEqual({ tag: 'p1', resident: false });
    expect(priorityChip({ priority: 'low' })).toEqual({ tag: 'p2', resident: false });
    expect(priorityChip({ priority: undefined })).toEqual({ tag: 'p3', resident: false });
  });
});

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
