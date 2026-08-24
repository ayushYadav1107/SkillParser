import { describe, it, assert, assertEqual } from './harness';
import { bootstrapMicroF1, pairedBootstrapF1 } from '../metrics/stats';
import type { Counts } from '../metrics/score';

const counts = (tp: number, fp: number, fn: number): Counts => ({ tp, fp, fn, tn: 0 });

describe('uncertainty', () => {
  it('produces an interval that brackets the point estimate', () => {
    const documents = Array.from({ length: 40 }, (_, i) => counts(i % 5 === 0 ? 7 : 9, 1, 1));
    const interval = bootstrapMicroF1(documents, { resamples: 400 });
    assert(interval.lower <= interval.point && interval.point <= interval.upper, 'point inside interval');
    assert(interval.upper - interval.lower > 0, 'interval should have width');
  });

  it('gives a narrower interval on more documents', () => {
    // The point of reporting an interval at all: sixty documents is not many.
    const small = bootstrapMicroF1(Array.from({ length: 8 }, () => counts(8, 2, 2)).map((c, i) =>
      i % 2 ? counts(5, 5, 5) : c
    ), { resamples: 500 });
    const large = bootstrapMicroF1(Array.from({ length: 200 }, (_, i) =>
      i % 2 ? counts(5, 5, 5) : counts(8, 2, 2)
    ), { resamples: 500 });
    assert(
      large.upper - large.lower < small.upper - small.lower,
      'more documents should tighten the interval'
    );
  });

  it('is reproducible from the same seed', () => {
    const documents = Array.from({ length: 20 }, (_, i) => counts(9 - (i % 3), 1, 1));
    const a = bootstrapMicroF1(documents, { resamples: 300, seed: 7 });
    const b = bootstrapMicroF1(documents, { resamples: 300, seed: 7 });
    assertEqual([a.lower, a.upper], [b.lower, b.upper]);
  });

  it('degrades gracefully on a single document', () => {
    const interval = bootstrapMicroF1([counts(5, 1, 1)]);
    assertEqual(interval.resamples, 0);
    assertEqual(interval.lower, interval.point);
  });

  it('detects a consistent per-document improvement that unpaired intervals would miss', () => {
    // Every document improves by a little, but the spread across documents is wide.
    // Two independent intervals would overlap heavily; the paired test sees it.
    const a = new Map<string, Counts>();
    const b = new Map<string, Counts>();
    for (let i = 0; i < 60; i += 1) {
      const difficulty = i % 10;
      a.set(`d${i}`, counts(20 - difficulty, difficulty, difficulty));
      b.set(`d${i}`, counts(21 - difficulty, Math.max(0, difficulty - 1), Math.max(0, difficulty - 1)));
    }
    const result = pairedBootstrapF1(a, b, { resamples: 800 });
    assert(result.delta > 0, 'B should be better');
    assert(result.pValue < 0.05, `expected significance, got p = ${result.pValue}`);
  });

  it('does not claim significance when the arms are identical', () => {
    const a = new Map<string, Counts>();
    for (let i = 0; i < 40; i += 1) a.set(`d${i}`, counts(8 + (i % 3), 2, 2));
    const result = pairedBootstrapF1(a, new Map(a), { resamples: 500 });
    assertEqual(result.delta, 0);
    assert(result.pValue > 0.05, `identical arms should not be significant, got ${result.pValue}`);
  });

  it('never reports an impossible p-value of exactly zero', () => {
    const a = new Map<string, Counts>();
    const b = new Map<string, Counts>();
    for (let i = 0; i < 50; i += 1) {
      a.set(`d${i}`, counts(1, 9, 9));
      b.set(`d${i}`, counts(10, 0, 0));
    }
    const result = pairedBootstrapF1(a, b, { resamples: 500 });
    assert(result.pValue > 0, 'p must be bounded below by 1/(resamples+1)');
  });

  it('compares only documents both arms scored, and says how many it dropped', () => {
    // An arm that skipped every scan is not comparable to one that attempted them;
    // averaging over different corpora would report the subset difference as a
    // provider difference.
    const a = new Map<string, Counts>([['d1', counts(9, 1, 1)], ['d2', counts(9, 1, 1)]]);
    const b = new Map<string, Counts>([['d1', counts(8, 2, 2)]]);
    const result = pairedBootstrapF1(a, b, { resamples: 100 });
    assertEqual(result.pairedDocuments, 1);
    assert(result.droppedDocuments > 0, 'should report the exclusion');
  });
});
