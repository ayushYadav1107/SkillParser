/**
 * @fileOverview Error taxonomy.
 *
 * An accuracy number tells you how often the system is wrong. It does not tell you
 * what to fix, and it cannot distinguish two systems with the same score and
 * completely different failure profiles — one dropping fields it could not find,
 * one confidently inventing them. Those call for opposite responses, and the second
 * is far more dangerous in a hiring tool: a missing skill is a gap a recruiter can
 * see, a fabricated one is not.
 *
 * Every failed field instance is therefore assigned exactly one category. The
 * classifier is ordered from most specific to least, because several categories
 * legitimately apply at once — a value read off the wrong column of a scanned page
 * is both column bleed and OCR damage — and the most diagnostic label wins.
 *
 * Two categories are informational and cost nothing in the headline metric:
 * `DATE_FORMAT_MISMATCH` (right interval, different notation, already normalised
 * away by the date comparator) and `SCHEMA_REPAIR` (the reply needed structural
 * repair before it could be read). They are reported because a model that requires
 * constant repair is a maintenance problem even when its extractions are right.
 */

import {
  characterSimilarity,
  freeTextSimilarity,
  shortFieldSimilarity,
} from './similarity';
import { isDateFormatOnlyDifference, normalizeText, tokenize } from './normalize';

export type ErrorCategory =
  /** Gold has a value; the prediction is empty. */
  | 'MISSING_FIELD'
  /** Gold is empty; the prediction invented a value. */
  | 'HALLUCINATED_FIELD'
  /** Both present, and the predicted value is a *different* value from elsewhere in the document. */
  | 'COLUMN_BLEED'
  /** Both present, and the difference is character-level damage consistent with OCR. */
  | 'OCR_CORRUPTION'
  /** The prediction is a proper prefix of the truth (or vice versa) — the read stopped early. */
  | 'TRUNCATION'
  /** Both present, substantially overlapping, but below the match threshold. */
  | 'PARTIAL_VALUE'
  /** Both present and unrelated. */
  | 'WRONG_VALUE'
  /** A gold entry the model did not produce at all. */
  | 'MISSED_ENTRY'
  /** A predicted entry corresponding to no gold entry. */
  | 'SPURIOUS_ENTRY'
  /** One gold entry emitted as two or more predicted entries. */
  | 'ENTRY_SPLIT'
  /** Two or more gold entries collapsed into one predicted entry. */
  | 'ENTRY_MERGE'
  /** Informational: correct interval, different notation. Costs nothing. */
  | 'DATE_FORMAT_MISMATCH'
  /** Informational: the reply needed structural repair before it could be parsed. */
  | 'SCHEMA_REPAIR'
  /** The provider failed outright for this document. */
  | 'PROVIDER_ERROR'
  /** A text-only provider was handed a scan and no OCR engine was available. */
  | 'OCR_UNAVAILABLE';

/** Categories that do not reduce the headline F1. */
export const INFORMATIONAL_CATEGORIES: ErrorCategory[] = ['DATE_FORMAT_MISMATCH', 'SCHEMA_REPAIR'];

export const ERROR_DESCRIPTIONS: Record<ErrorCategory, string> = {
  MISSING_FIELD: 'The document contained the value and the model returned nothing.',
  HALLUCINATED_FIELD: 'The document did not contain this field and the model produced a value anyway.',
  COLUMN_BLEED: 'The returned value is real text from a different part of the document — the reading order was wrong.',
  OCR_CORRUPTION: 'The value is recognisably right but character-level damaged, consistent with OCR on a degraded scan.',
  TRUNCATION: 'The returned value is a prefix of the true value; the read stopped early.',
  PARTIAL_VALUE: 'Substantially overlapping with the truth but below the match threshold.',
  WRONG_VALUE: 'Both values present and unrelated to each other.',
  MISSED_ENTRY: 'An entire experience or education entry was not returned.',
  SPURIOUS_ENTRY: 'An entry was returned that corresponds to nothing in the document.',
  ENTRY_SPLIT: 'One role or degree was emitted as two or more separate entries.',
  ENTRY_MERGE: 'Two or more roles or degrees were collapsed into a single entry.',
  DATE_FORMAT_MISMATCH: 'The date interval is correct but written in a different notation. Informational only.',
  SCHEMA_REPAIR: 'The reply had to be structurally repaired before it could be read. Informational only.',
  PROVIDER_ERROR: 'The provider failed for this document and returned no extraction.',
  OCR_UNAVAILABLE: 'A text-only provider was given a scanned image and no OCR engine was installed.',
};

export interface ClassificationContext {
  /** Every other gold value in this document, used to detect reading-order bleed. */
  otherGoldValues: string[];
  /** True for the scanned conditions, which makes OCR damage a plausible explanation. */
  scanned: boolean;
  /** True for date fields, which get the format-only check first. */
  isDate: boolean;
  /** Free text uses token overlap; short fields use the blended measure. */
  isFreeText: boolean;
}

/**
 * Assigns exactly one category to a failed scalar field.
 *
 * The `COLUMN_BLEED` test is the one that earns its complexity: the predicted value
 * has to look substantially *more* like some other field of the same document than
 * like the field it was asked for. Without that comparison, any wrong answer that
 * happened to share a word with the document would be labelled a reading-order
 * problem, and the category would stop meaning anything.
 */
export function classifyFieldError(
  gold: string,
  predicted: string,
  context: ClassificationContext
): ErrorCategory {
  const goldEmpty = normalizeText(gold).length === 0;
  const predEmpty = normalizeText(predicted).length === 0;

  if (!goldEmpty && predEmpty) return 'MISSING_FIELD';
  if (goldEmpty && !predEmpty) return 'HALLUCINATED_FIELD';

  if (context.isDate && isDateFormatOnlyDifference(gold, predicted)) return 'DATE_FORMAT_MISMATCH';

  const similarity = context.isFreeText
    ? freeTextSimilarity(gold, predicted)
    : shortFieldSimilarity(gold, predicted);

  // Reading-order bleed: the model returned real text, just from the wrong place.
  let bestOther = 0;
  for (const other of context.otherGoldValues) {
    if (normalizeText(other).length < 3) continue;
    const s = shortFieldSimilarity(other, predicted);
    if (s > bestOther) bestOther = s;
  }
  if (bestOther >= 0.8 && bestOther > similarity + 0.2) return 'COLUMN_BLEED';

  // OCR damage: same length, same shape, characters mangled. Token overlap is poor
  // precisely because the words no longer match exactly, which is why the character
  // measure has to be the one consulted here.
  if (context.scanned) {
    const charSimilarity = characterSimilarity(gold, predicted);
    const lengthRatio =
      Math.min(gold.length, predicted.length) / Math.max(gold.length, predicted.length, 1);
    if (charSimilarity >= 0.6 && lengthRatio >= 0.75) return 'OCR_CORRUPTION';
  }

  if (isPrefixTruncation(gold, predicted)) return 'TRUNCATION';

  if (similarity >= 0.4) return 'PARTIAL_VALUE';
  return 'WRONG_VALUE';
}

/**
 * A truncation is one value being an initial segment of the other, with a real
 * length gap. The 0.9 ceiling excludes near-identical strings, which are better
 * described as a partial match than as the model stopping early.
 */
function isPrefixTruncation(gold: string, predicted: string): boolean {
  const g = normalizeText(gold);
  const p = normalizeText(predicted);
  if (!g || !p || g === p) return false;
  const [shorter, longer] = g.length <= p.length ? [g, p] : [p, g];
  if (shorter.length < 8) return false;
  if (shorter.length / longer.length > 0.9) return false;
  if (longer.startsWith(shorter)) return true;
  // Word-boundary version, for values trimmed at a space rather than mid-token.
  const shortTokens = tokenize(shorter);
  const longTokens = tokenize(longer);
  if (shortTokens.length < 2 || shortTokens.length >= longTokens.length) return false;
  return shortTokens.every((t, i) => longTokens[i] === t);
}

export function emptyErrorCounts(): Record<ErrorCategory, number> {
  return Object.fromEntries(
    (Object.keys(ERROR_DESCRIPTIONS) as ErrorCategory[]).map((k) => [k, 0])
  ) as Record<ErrorCategory, number>;
}
