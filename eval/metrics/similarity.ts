/**
 * @fileOverview Similarity functions, and the thresholds that turn them into
 * match/no-match decisions.
 *
 * Why two families of measure
 * ---------------------------
 * Character-level and token-level similarity fail in opposite directions, and
 * resume fields need both.
 *
 * Character edit distance handles OCR damage — `Quintalinc Systoms` is obviously
 * `Quintaline Systems` at 0.9 character similarity — but collapses on word order
 * and on any legitimate difference in length. Token overlap handles reordering and
 * length differences, which is what free-text descriptions need, but scores
 * `Quintalinc Systoms` against `Quintaline Systems` at zero, because not one token
 * matches exactly. A parser reading a slightly blurry scan would look catastrophic
 * under one measure and fine under the other.
 *
 * So short identifier-like fields (names, companies, titles) use the maximum of the
 * two, and free text uses token F1 alone — a single mangled word in a
 * forty-word description should not matter, and character distance over long
 * strings is dominated by length differences anyway.
 *
 * Thresholds
 * ----------
 * Binarising a continuous similarity at a threshold is a modelling choice, and a
 * reviewer is right to ask whether the conclusions survive a different one. Two
 * things address that: the report always includes the mean continuous similarity
 * next to the binary F1, and the harness recomputes every headline metric at 0.70 /
 * 0.80 / 0.85 / 0.90 and prints a sensitivity table. A conclusion that only holds
 * at one threshold is not a conclusion.
 */

import { normalizeOrganization, normalizeText, tokenize } from './normalize';

/** Default cut for short identifier-like fields. */
export const SHORT_FIELD_THRESHOLD = 0.85;
/** Default cut for free text, where partial recall is genuinely partial credit. */
export const FREE_TEXT_THRESHOLD = 0.7;
/** Thresholds swept in the sensitivity table. */
export const SENSITIVITY_THRESHOLDS = [0.7, 0.8, 0.85, 0.9] as const;

/** Levenshtein distance with the usual two-row optimisation. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 1 − (edit distance / longer length). In [0, 1]. */
export function characterSimilarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/**
 * Token F1 over multisets.
 *
 * Multiset rather than set: a description that repeats "accessibility" three times
 * against a gold that says it once should not get three matches out of it. Using
 * sets would quietly reward padding.
 */
export function tokenF1(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);

  let overlap = 0;
  for (const t of tb) {
    const remaining = counts.get(t) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(t, remaining - 1);
    }
  }

  const precision = overlap / tb.length;
  const recall = overlap / ta.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** Short identifier-like fields: the more forgiving of the two measures. */
export function shortFieldSimilarity(a: string, b: string): number {
  return Math.max(characterSimilarity(a, b), tokenF1(a, b));
}

/** Organisation names, after legal-suffix removal. */
export function organizationSimilarity(a: string, b: string): number {
  const x = normalizeOrganization(a);
  const y = normalizeOrganization(b);
  return Math.max(characterSimilarity(x, y), tokenF1(x, y));
}

/** Free text: token overlap only. */
export function freeTextSimilarity(a: string, b: string): number {
  return tokenF1(a, b);
}

/**
 * Greedy one-to-one matching between two lists of strings.
 *
 * Greedy rather than optimal, and that is a deliberate difference from the entry
 * aligner (which is exact). Skill lists routinely run to a dozen entries on each
 * side, similarity between distinct skills is near zero so the assignment is almost
 * never ambiguous, and an exact solver over that many candidates buys nothing
 * measurable for the cost. Where the assignment genuinely *is* ambiguous — resume
 * entries, which are few and mutually similar — the exact algorithm is used.
 */
export function matchSets(
  gold: string[],
  predicted: string[],
  similarity: (a: string, b: string) => number,
  threshold: number
): { matched: Array<{ goldIndex: number; predIndex: number; score: number }>; unmatchedGold: number[]; unmatchedPred: number[] } {
  const candidates: Array<{ goldIndex: number; predIndex: number; score: number }> = [];
  for (let g = 0; g < gold.length; g += 1) {
    for (let p = 0; p < predicted.length; p += 1) {
      const score = similarity(gold[g], predicted[p]);
      if (score >= threshold) candidates.push({ goldIndex: g, predIndex: p, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedGold = new Set<number>();
  const usedPred = new Set<number>();
  const matched: typeof candidates = [];
  for (const c of candidates) {
    if (usedGold.has(c.goldIndex) || usedPred.has(c.predIndex)) continue;
    usedGold.add(c.goldIndex);
    usedPred.add(c.predIndex);
    matched.push(c);
  }

  return {
    matched,
    unmatchedGold: gold.map((_, i) => i).filter((i) => !usedGold.has(i)),
    unmatchedPred: predicted.map((_, i) => i).filter((i) => !usedPred.has(i)),
  };
}
