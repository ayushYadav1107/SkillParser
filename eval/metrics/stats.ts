/**
 * @fileOverview Uncertainty. The part most extraction write-ups leave out.
 *
 * "Provider A scored 0.91 and provider B scored 0.89" is not a finding on sixty
 * documents. The two-point gap could easily be four resumes that happened to fall
 * one way, and a reader has no way to tell from the point estimates alone. Every
 * headline number in the report therefore carries a bootstrap interval, and every
 * A-vs-B claim carries a paired test.
 *
 * Resampling is over **documents, not field instances**. Field instances within one
 * resume are not independent — a scan that blurred badly ruins every field on the
 * page together, and a model that misread the section headings misplaces all of
 * them at once. Resampling instances would treat those correlated failures as
 * independent evidence and produce intervals several times too narrow. The document
 * is the independent sampling unit because the document is what was independently
 * drawn.
 *
 * The A-vs-B test is **paired**: the same resampled set of documents is scored under
 * both arms and the difference taken within the resample. Both arms saw exactly the
 * same corpus, so the shared per-document difficulty cancels, and the test is
 * dramatically more sensitive than comparing two independent intervals. Two
 * overlapping confidence intervals do not imply a non-significant difference, which
 * is the specific mistake this function exists to avoid.
 */

import { Rng } from '../corpus/rng';
import { addCounts, emptyCounts, prf, type Counts } from './score';

export const DEFAULT_RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 987654321;

export interface Interval {
  point: number;
  lower: number;
  upper: number;
  /** Nominal coverage, e.g. 0.95. */
  level: number;
  resamples: number;
}

/**
 * Percentile bootstrap over documents for a statistic computed from pooled counts.
 *
 * `perDocument` is one `Counts` per document; the statistic is recomputed from the
 * pooled counts of each resample. This is the micro-averaged case; the macro case
 * is handled by `bootstrapCustom`.
 */
export function bootstrapMicroF1(
  perDocument: Counts[],
  opts: { resamples?: number; level?: number; seed?: number } = {}
): Interval {
  return bootstrapCustom(
    perDocument,
    (sample) => {
      const pooled = emptyCounts();
      for (const c of sample) addCounts(pooled, c);
      return prf(pooled).f1;
    },
    opts
  );
}

export function bootstrapCustom<T>(
  units: T[],
  statistic: (sample: T[]) => number,
  opts: { resamples?: number; level?: number; seed?: number } = {}
): Interval {
  const resamples = opts.resamples ?? DEFAULT_RESAMPLES;
  const level = opts.level ?? 0.95;
  const rng = new Rng(opts.seed ?? BOOTSTRAP_SEED);
  const n = units.length;

  const point = n === 0 ? 0 : statistic(units);
  if (n < 2) {
    return { point, lower: point, upper: point, level, resamples: 0 };
  }

  const values = new Float64Array(resamples);
  const sample = new Array<T>(n);
  for (let b = 0; b < resamples; b += 1) {
    for (let i = 0; i < n; i += 1) sample[i] = units[rng.int(0, n - 1)];
    values[b] = statistic(sample);
  }

  const sorted = Array.from(values).sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    point,
    lower: percentile(sorted, alpha),
    upper: percentile(sorted, 1 - alpha),
    level,
    resamples,
  };
}

export interface PairedComparison {
  /** armB − armA. Positive means B is better. */
  delta: number;
  lower: number;
  upper: number;
  level: number;
  /** Two-sided bootstrap p-value for H0: delta = 0. */
  pValue: number;
  resamples: number;
  /** Documents present in both arms. The test is only defined on these. */
  pairedDocuments: number;
  /** Documents scored in one arm but not the other, and therefore excluded. */
  droppedDocuments: number;
}

/**
 * Paired percentile bootstrap on the difference in micro-F1 between two arms.
 *
 * Only documents scored by *both* arms take part. Dropping the rest is not
 * fastidiousness: if one arm skipped every scanned resume because OCR was
 * unavailable, comparing its average against an arm that attempted them compares
 * two different corpora, and the "difference between providers" would be mostly the
 * difference between the easy subset and the whole set. The count of dropped
 * documents is returned so the report can say so out loud.
 */
export function pairedBootstrapF1(
  armA: Map<string, Counts>,
  armB: Map<string, Counts>,
  opts: { resamples?: number; level?: number; seed?: number } = {}
): PairedComparison {
  const resamples = opts.resamples ?? DEFAULT_RESAMPLES;
  const level = opts.level ?? 0.95;
  const rng = new Rng(opts.seed ?? BOOTSTRAP_SEED + 1);

  const shared = [...armA.keys()].filter((k) => armB.has(k));
  const dropped = armA.size + armB.size - shared.length * 2;

  const pairs = shared.map((k) => ({ a: armA.get(k)!, b: armB.get(k)! }));
  const f1Of = (list: Counts[]): number => {
    const pooled = emptyCounts();
    for (const c of list) addCounts(pooled, c);
    return prf(pooled).f1;
  };

  const observed = f1Of(pairs.map((p) => p.b)) - f1Of(pairs.map((p) => p.a));

  if (pairs.length < 2) {
    return {
      delta: observed,
      lower: observed,
      upper: observed,
      level,
      pValue: 1,
      resamples: 0,
      pairedDocuments: pairs.length,
      droppedDocuments: Math.max(0, dropped),
    };
  }

  const deltas = new Float64Array(resamples);
  const sampleA: Counts[] = new Array(pairs.length);
  const sampleB: Counts[] = new Array(pairs.length);

  for (let b = 0; b < resamples; b += 1) {
    for (let i = 0; i < pairs.length; i += 1) {
      // The same index for both arms — that is what makes it paired.
      const pick = pairs[rng.int(0, pairs.length - 1)];
      sampleA[i] = pick.a;
      sampleB[i] = pick.b;
    }
    deltas[b] = f1Of(sampleB) - f1Of(sampleA);
  }

  const sorted = Array.from(deltas).sort((a, b) => a - b);
  const alpha = (1 - level) / 2;

  // Two-sided p-value by the proportion of resampled deltas on the far side of
  // zero, doubled and clamped. The +1 corrections keep it from ever reporting an
  // impossible p = 0: with 2000 resamples the smallest supportable claim is
  // p < 1/2001, and rounding that to zero would overstate the evidence.
  const below = sorted.filter((d) => d <= 0).length;
  const above = sorted.filter((d) => d >= 0).length;
  const pValue = Math.min(1, (2 * (Math.min(below, above) + 1)) / (resamples + 1));

  return {
    delta: observed,
    lower: percentile(sorted, alpha),
    upper: percentile(sorted, 1 - alpha),
    level,
    pValue,
    resamples,
    pairedDocuments: pairs.length,
    droppedDocuments: Math.max(0, dropped),
  };
}

function percentile(sortedAscending: number[], q: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = (sortedAscending.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower];
  return sortedAscending[lower] + (index - lower) * (sortedAscending[upper] - sortedAscending[lower]);
}

/** Formats an interval the way the tables print it. */
export function formatInterval(interval: Interval, digits = 3): string {
  return `${interval.point.toFixed(digits)} [${interval.lower.toFixed(digits)}, ${interval.upper.toFixed(digits)}]`;
}

export function formatPValue(p: number): string {
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}
