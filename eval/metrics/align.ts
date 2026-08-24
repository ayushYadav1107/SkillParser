/**
 * @fileOverview Aligning predicted resume entries to gold entries.
 *
 * Experience and education are lists, and the model's list is not guaranteed to be
 * in the same order or of the same length as the truth. Comparing them positionally
 * — `predicted[0]` against `gold[0]` — is the obvious implementation and it is
 * wrong in a way that manufactures failures: a model that reads three roles
 * perfectly but emits them oldest-first scores near zero. So the two lists are
 * matched before anything is scored.
 *
 * Optimal, not greedy
 * -------------------
 * Two roles at the same employer (a promotion) are highly similar to each other, so
 * a greedy matcher that takes the best pair first can consume the wrong one and
 * force a cascade of bad assignments down the list. Resume lists are short — five
 * entries is a long one — so the exact maximum-weight assignment is affordable:
 * bitmask dynamic programming over gold entries, O(2^n · n · m), microseconds at
 * these sizes. The entry aligner is exact for that reason while the skill matcher
 * is greedy; the difference tracks how ambiguous the assignment actually is.
 *
 * Split and merge
 * ---------------
 * A one-to-one assignment cannot represent "the model split one role into two" or
 * "the model merged two roles into one", but those are two of the most informative
 * failure modes in resume parsing and the error taxonomy needs them. They are
 * recovered after matching: an unmatched *prediction* that is still similar to an
 * already-matched gold entry is a split; an unmatched *gold* entry whose best
 * candidate was taken by another gold entry is a merge.
 */

import { freeTextSimilarity, organizationSimilarity, shortFieldSimilarity } from './similarity';
import { dateIntervalsMatch } from './normalize';

export interface AlignableEntry {
  /** Company or institution. */
  organization: string;
  /** Job title or degree. */
  label: string;
  /** Duration or graduation date. */
  date: string;
  /** Description; empty for education entries. */
  body: string;
}

export interface AlignedPair {
  goldIndex: number;
  predIndex: number;
  score: number;
}

export interface Alignment {
  pairs: AlignedPair[];
  unmatchedGold: number[];
  unmatchedPred: number[];
  /** Gold indices whose content was spread across more than one predicted entry. */
  splits: Array<{ goldIndex: number; extraPredIndices: number[] }>;
  /** Gold indices absorbed into a predicted entry already claimed by another gold. */
  merges: Array<{ goldIndex: number; predIndex: number }>;
}

/**
 * Below this an entry pair is considered to be about different jobs entirely, and
 * matching them would produce meaningless sub-field scores. Above it the pair is
 * matched even when it scores badly, because a badly-read entry is still *that*
 * entry, and the sub-field metrics are where its errors should show up.
 */
export const ENTRY_MATCH_THRESHOLD = 0.35;
/** Above this, an extra predicted entry counts as a split rather than a hallucination. */
export const SPLIT_THRESHOLD = 0.45;

/**
 * Composite entry similarity.
 *
 * Weighted toward organisation and title because those identify *which* entry this
 * is; the date contributes less because many resumes reuse year ranges, and the
 * description least because two roles at one company often describe similar work.
 * The weights decide alignment only — they never enter a reported score.
 */
export function entrySimilarity(gold: AlignableEntry, pred: AlignableEntry): number {
  const org = organizationSimilarity(gold.organization, pred.organization);
  const label = shortFieldSimilarity(gold.label, pred.label);
  const date = dateIntervalsMatch(gold.date, pred.date) ? 1 : shortFieldSimilarity(gold.date, pred.date);
  const body =
    gold.body || pred.body ? freeTextSimilarity(gold.body, pred.body) : (org + label) / 2;
  return 0.4 * org + 0.32 * label + 0.16 * date + 0.12 * body;
}

export function alignEntries(gold: AlignableEntry[], predicted: AlignableEntry[]): Alignment {
  const n = gold.length;
  const m = predicted.length;

  if (n === 0 || m === 0) {
    return {
      pairs: [],
      unmatchedGold: gold.map((_, i) => i),
      unmatchedPred: predicted.map((_, i) => i),
      splits: [],
      merges: [],
    };
  }

  const score: number[][] = gold.map((g) => predicted.map((p) => entrySimilarity(g, p)));
  const assignment = maximumWeightAssignment(score);

  const pairs: AlignedPair[] = [];
  const unmatchedGold: number[] = [];
  const claimedPred = new Set<number>();

  for (let g = 0; g < n; g += 1) {
    const p = assignment[g];
    if (p >= 0 && score[g][p] >= ENTRY_MATCH_THRESHOLD) {
      pairs.push({ goldIndex: g, predIndex: p, score: score[g][p] });
      claimedPred.add(p);
    } else {
      unmatchedGold.push(g);
    }
  }

  const unmatchedPred = predicted.map((_, i) => i).filter((i) => !claimedPred.has(i));

  // Splits: a leftover prediction that still looks like a matched gold entry.
  const splits: Alignment['splits'] = [];
  for (const p of unmatchedPred) {
    let bestGold = -1;
    let bestScore = 0;
    for (const pair of pairs) {
      if (score[pair.goldIndex][p] > bestScore) {
        bestScore = score[pair.goldIndex][p];
        bestGold = pair.goldIndex;
      }
    }
    if (bestGold >= 0 && bestScore >= SPLIT_THRESHOLD) {
      const existing = splits.find((s) => s.goldIndex === bestGold);
      if (existing) existing.extraPredIndices.push(p);
      else splits.push({ goldIndex: bestGold, extraPredIndices: [p] });
    }
  }

  // Merges: an unmatched gold entry whose best prediction was taken by another gold.
  const merges: Alignment['merges'] = [];
  for (const g of unmatchedGold) {
    let bestPred = -1;
    let bestScore = 0;
    for (let p = 0; p < m; p += 1) {
      if (score[g][p] > bestScore) {
        bestScore = score[g][p];
        bestPred = p;
      }
    }
    if (bestPred >= 0 && claimedPred.has(bestPred) && bestScore >= SPLIT_THRESHOLD) {
      merges.push({ goldIndex: g, predIndex: bestPred });
    }
  }

  return { pairs, unmatchedGold, unmatchedPred, splits, merges };
}

/**
 * Exact maximum-weight bipartite assignment by bitmask DP over the predicted side.
 *
 * Returns, for each gold row, the predicted column assigned to it, or −1. Falls back
 * to a greedy assignment when the predicted list is long enough that 2^m would be
 * expensive — that bound is never reached by a real resume, but a model that emits
 * forty hallucinated entries should degrade rather than hang.
 */
export function maximumWeightAssignment(score: number[][]): number[] {
  const n = score.length;
  const m = score[0]?.length ?? 0;
  if (m === 0) return new Array(n).fill(-1);
  if (m > 20) return greedyAssignment(score);

  const size = 1 << m;
  // best[row][mask] = best total score assigning rows [row..n) using free columns in mask.
  const best = new Float64Array((n + 1) * size).fill(Number.NEGATIVE_INFINITY);
  const choice = new Int16Array((n + 1) * size).fill(-1);

  for (let mask = 0; mask < size; mask += 1) best[n * size + mask] = 0;

  for (let row = n - 1; row >= 0; row -= 1) {
    for (let mask = 0; mask < size; mask += 1) {
      // Leaving a gold row unassigned is always allowed; a model may simply have
      // missed it, and forcing an assignment would invent a match.
      let bestValue = best[(row + 1) * size + mask];
      let bestColumn = -1;
      for (let col = 0; col < m; col += 1) {
        if ((mask & (1 << col)) === 0) continue;
        const value = score[row][col] + best[(row + 1) * size + (mask & ~(1 << col))];
        if (value > bestValue) {
          bestValue = value;
          bestColumn = col;
        }
      }
      best[row * size + mask] = bestValue;
      choice[row * size + mask] = bestColumn;
    }
  }

  const result = new Array<number>(n).fill(-1);
  let mask = size - 1;
  for (let row = 0; row < n; row += 1) {
    const col = choice[row * size + mask];
    result[row] = col;
    if (col >= 0) mask &= ~(1 << col);
  }
  return result;
}

function greedyAssignment(score: number[][]): number[] {
  const n = score.length;
  const m = score[0].length;
  const flat: Array<{ r: number; c: number; v: number }> = [];
  for (let r = 0; r < n; r += 1) for (let c = 0; c < m; c += 1) flat.push({ r, c, v: score[r][c] });
  flat.sort((a, b) => b.v - a.v);
  const result = new Array<number>(n).fill(-1);
  const usedCol = new Set<number>();
  for (const { r, c } of flat) {
    if (result[r] !== -1 || usedCol.has(c)) continue;
    result[r] = c;
    usedCol.add(c);
  }
  return result;
}
