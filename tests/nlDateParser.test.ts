import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNlDate, type NlDate } from '../src/time/nlDateParser';

// Corpus lives in a standalone JSON file (spec: easy to extend). Loaded via fs to avoid
// resolveJsonModule; `now` is fixed and injected so the parser stays deterministic.
interface Corpus {
  now: string;
  positive: Array<{ text: string; expect: NlDate }>;
  negative: string[];
}

const corpusPath = fileURLToPath(new URL('./corpus/nl-dates.json', import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;

function parseLocal(s: string): Date {
  const [d, t] = s.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi);
}
const NOW = parseLocal(corpus.now);

describe('parseNlDate positives (FR-009)', () => {
  for (const c of corpus.positive) {
    it(`"${c.text}"`, () => {
      expect(parseNlDate(c.text, NOW)).toEqual(c.expect);
    });
  }
});

describe('parseNlDate negatives → null (SC-006, no character loss)', () => {
  for (const text of corpus.negative) {
    it(`"${text}" → null`, () => {
      expect(parseNlDate(text, NOW)).toBeNull();
    });
  }
});

describe('corpus size + pass rate (SC-006)', () => {
  it('carries ≥60 positive and ≥8 negative cases', () => {
    expect(corpus.positive.length).toBeGreaterThanOrEqual(60);
    expect(corpus.negative.length).toBeGreaterThanOrEqual(8);
  });

  it('pass rate ≥95% across the closed corpus', () => {
    const cases = [
      ...corpus.positive.map((c) => ({ text: c.text, expected: c.expect as NlDate | null })),
      ...corpus.negative.map((text) => ({ text, expected: null as NlDate | null })),
    ];
    // Canonical stringify: sort keys + drop undefined, so key order doesn't skew the rate.
    const canon = (v: NlDate | null): string =>
      v === null ? 'null' : JSON.stringify(v, Object.keys(v).sort());
    let pass = 0;
    for (const { text, expected } of cases) {
      if (canon(parseNlDate(text, NOW)) === canon(expected)) pass++;
    }
    const rate = pass / cases.length;
    // eslint-disable-next-line no-console
    console.log(`nlDateParser corpus pass rate: ${pass}/${cases.length} = ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
