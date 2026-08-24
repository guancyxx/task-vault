import { describe, expect, it } from 'vitest';
import { countClass } from '../src/view/sidebarView';

// FR-047 count semantics: a non-zero overdue/review/today count gets a bucket-coloured pill class;
// week/done and any zero count stay the bare grey tv-count. Pure — the render just spreads the array.
describe('countClass (FR-047 count semantics)', () => {
  it('overlays a bucket class only when the alert buckets are non-zero', () => {
    expect(countClass('overdue', 3)).toEqual(['tv-count', 'tv-count-alert']);
    expect(countClass('review', 1)).toEqual(['tv-count', 'tv-count-review']);
    expect(countClass('today', 2)).toEqual(['tv-count', 'tv-count-today']);
  });

  it('stays bare grey for week/done and for any zero count', () => {
    expect(countClass('week', 9)).toEqual(['tv-count']);
    expect(countClass('done', 4)).toEqual(['tv-count']);
    expect(countClass('overdue', 0)).toEqual(['tv-count']);
    expect(countClass('review', 0)).toEqual(['tv-count']);
    expect(countClass('today', 0)).toEqual(['tv-count']);
  });
});
