import { describe, expect, it } from 'vitest';
import { createT, tArray } from '../src/i18n';
import { pickExample } from '../src/view/sidebarView';

// FR-045 capture placeholder rotation: examples are stored newline-joined in the dicts and split
// by tArray; the placeholder picks one per render. Both pieces are pure, so they unit-test without
// a DOM (the render itself is DOM-only and covered in-app per SC-023).
describe('capture examples (FR-045)', () => {
  it('tArray splits the newline-joined examples (≥4 each, no blanks)', () => {
    for (const lang of ['zh-CN', 'en'] as const) {
      const examples = tArray(createT(lang), 'capture.examples');
      expect(examples.length).toBeGreaterThanOrEqual(4);
      for (const ex of examples) expect(ex.length).toBeGreaterThan(0);
    }
  });

  it('pickExample rotates deterministically with an injected rng and is empty-safe', () => {
    const xs = ['a', 'b', 'c'];
    expect(pickExample(xs, () => 0)).toBe('a');
    expect(pickExample(xs, () => 0.5)).toBe('b');
    expect(pickExample(xs, () => 0.999)).toBe('c');
    expect(pickExample([], () => 0)).toBe('');
  });
});
