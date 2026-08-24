/**
 * @fileOverview Scoring one extraction against one ground-truth label.
 *
 * The unit of measurement is a **field instance**: one (document, field-path) pair,
 * such as `personal.email` for document r003, or one element of `skills`. Every
 * instance lands in exactly one of four outcomes:
 *
 *   - **TP** — truth has a value, the prediction matches it.
 *   - **FN** — truth has a value, the prediction is empty. A miss.
 *   - **FP** — truth is empty, the prediction has a value. A hallucination.
 *   - **TP-miss** — both present but different. Counted as one FP *and* one FN,
 *     because the system both failed to produce the right value and produced a
 *     wrong one, and collapsing that into a single error would let precision and
 *     recall drift apart from what they mean.
 *
 * Instances where both sides are empty are true negatives. They are counted for
 * reporting and excluded from precision and recall, since a resume with no phone
 * number is not evidence that a parser reads phone numbers well.
 *
 * Micro and macro are both reported
 * ---------------------------------
 * Micro-F1 pools every instance, so it is dominated by `skills` — a dozen instances
 * per resume against one for `email`. Macro-F1 averages the per-field F1s, giving
 * `email` and `skills` equal say. Neither is the right answer on its own: micro
 * says how many facts the system gets right, macro says how uniformly it performs
 * across field types. Reporting only one is where a lot of extraction benchmarks
 * quietly choose the flattering number.
 */

import type {
  EducationEntry,
  ExperienceEntry,
  GroundTruthResume,
  ParsedResume,
} from '../../src/lib/resume-schema';
import { alignEntries, type AlignableEntry, type Alignment } from './align';
import { classifyFieldError, type ErrorCategory } from './errors';
import {
  dateIntervalsMatch,
  isEmpty,
  normalizeEmail,
  normalizeLocation,
  normalizePhone,
  normalizeText,
} from './normalize';
import {
  FREE_TEXT_THRESHOLD,
  SHORT_FIELD_THRESHOLD,
  freeTextSimilarity,
  matchSets,
  organizationSimilarity,
  shortFieldSimilarity,
} from './similarity';

export const FIELD_KEYS = [
  'personal.name',
  'personal.email',
  'personal.phone',
  'personal.location',
  'skills',
  'certifications',
  'experience.entry',
  'experience.title',
  'experience.company',
  'experience.duration',
  'experience.description',
  'education.entry',
  'education.degree',
  'education.institution',
  'education.graduationDate',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Field groups used by the report's summary table. */
export const FIELD_GROUPS: Record<string, FieldKey[]> = {
  'Contact details': ['personal.name', 'personal.email', 'personal.phone', 'personal.location'],
  Skills: ['skills'],
  Certifications: ['certifications'],
  Experience: [
    'experience.entry',
    'experience.title',
    'experience.company',
    'experience.duration',
    'experience.description',
  ],
  Education: [
    'education.entry',
    'education.degree',
    'education.institution',
    'education.graduationDate',
  ],
};

export type Outcome = 'tp' | 'fp' | 'fn' | 'both' | 'tn';

export interface FieldObservation {
  field: FieldKey;
  outcome: Outcome;
  /** Continuous similarity, or null where the comparison was exact (email, dates). */
  similarity: number | null;
  gold: string;
  predicted: string;
  /** Self-reported model certainty for this instance; null when not reported. */
  confidence: number | null;
  errorCategory: ErrorCategory | null;
}

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface DocumentScore {
  documentId: string;
  recordId: string;
  observations: FieldObservation[];
  perField: Record<FieldKey, Counts>;
  /** Entry-level alignment diagnostics, kept for the error table. */
  alignment: { experience: Alignment; education: Alignment };
}

export interface ScoreOptions {
  /** True for the scanned conditions; enables the OCR-damage error category. */
  scanned: boolean;
  shortFieldThreshold?: number;
  freeTextThreshold?: number;
}

export function scoreDocument(
  documentId: string,
  recordId: string,
  truth: GroundTruthResume,
  predicted: ParsedResume,
  options: ScoreOptions
): DocumentScore {
  const shortThreshold = options.shortFieldThreshold ?? SHORT_FIELD_THRESHOLD;
  const freeThreshold = options.freeTextThreshold ?? FREE_TEXT_THRESHOLD;
  const observations: FieldObservation[] = [];
  const confidence = predicted.confidence ?? {};

  // Everything else in the document, for the reading-order bleed test.
  const allGoldValues = collectGoldValues(truth);

  // --- contact details ---------------------------------------------------
  observations.push(
    scalar('personal.name', truth.personal.name, predicted.personal.name, {
      similarity: (a, b) => shortFieldSimilarity(a, b),
      threshold: shortThreshold,
      confidence: confidence.name ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );
  observations.push(
    scalar('personal.email', truth.personal.email, predicted.personal.email, {
      // Exact after normalisation: an email address with one character wrong is not
      // a partially correct email address, it is a wrong one.
      exact: (a, b) => normalizeEmail(a) === normalizeEmail(b),
      confidence: confidence.email ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );
  observations.push(
    scalar('personal.phone', truth.personal.phone, predicted.personal.phone, {
      exact: (a, b) => normalizePhone(a) === normalizePhone(b) && normalizePhone(a).length >= 7,
      confidence: confidence.phone ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );
  observations.push(
    scalar('personal.location', truth.personal.location, predicted.personal.location, {
      similarity: (a, b) => shortFieldSimilarity(normalizeLocation(a), normalizeLocation(b)),
      threshold: shortThreshold,
      confidence: confidence.location ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );

  // --- set-valued fields -------------------------------------------------
  observations.push(
    ...scoreSet('skills', truth.skills, predicted.skills, shortThreshold, {
      perItemConfidence: confidence.skillConfidences ?? null,
      groupConfidence: confidence.skills ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );
  observations.push(
    ...scoreSet('certifications', truth.certifications, predicted.certifications, shortThreshold, {
      perItemConfidence: null,
      groupConfidence: confidence.certifications ?? null,
      allGoldValues,
      scanned: options.scanned,
    })
  );

  // --- entry lists -------------------------------------------------------
  const experienceAlignment = alignEntries(
    truth.experience.map(toAlignableExperience),
    predicted.experience.map(toAlignableExperience)
  );
  observations.push(
    ...scoreEntries<ExperienceEntry>({
      alignment: experienceAlignment,
      entryKey: 'experience.entry',
      subFields: [
        { key: 'experience.title', pick: (e) => e.title, kind: 'short' },
        { key: 'experience.company', pick: (e) => e.company, kind: 'org' },
        { key: 'experience.duration', pick: (e) => e.duration, kind: 'date' },
        { key: 'experience.description', pick: (e) => e.description, kind: 'free' },
      ],
      gold: truth.experience,
      predicted: predicted.experience,
      groupConfidence: confidence.experience ?? null,
      shortThreshold,
      freeThreshold,
      allGoldValues,
      scanned: options.scanned,
    })
  );

  const educationAlignment = alignEntries(
    truth.education.map(toAlignableEducation),
    predicted.education.map(toAlignableEducation)
  );
  observations.push(
    ...scoreEntries<EducationEntry>({
      alignment: educationAlignment,
      entryKey: 'education.entry',
      subFields: [
        { key: 'education.degree', pick: (e) => e.degree, kind: 'short' },
        { key: 'education.institution', pick: (e) => e.institution, kind: 'org' },
        { key: 'education.graduationDate', pick: (e) => e.graduationDate, kind: 'date' },
      ],
      gold: truth.education,
      predicted: predicted.education,
      groupConfidence: confidence.education ?? null,
      shortThreshold,
      freeThreshold,
      allGoldValues,
      scanned: options.scanned,
    })
  );

  return {
    documentId,
    recordId,
    observations,
    perField: tallyByField(observations),
    alignment: { experience: experienceAlignment, education: educationAlignment },
  };
}

// ---------------------------------------------------------------------------
// Scalar fields
// ---------------------------------------------------------------------------

interface ScalarOptions {
  similarity?: (a: string, b: string) => number;
  exact?: (a: string, b: string) => boolean;
  threshold?: number;
  confidence: number | null;
  allGoldValues: string[];
  scanned: boolean;
  isDate?: boolean;
  isFreeText?: boolean;
}

function scalar(
  field: FieldKey,
  gold: string,
  predicted: string,
  opts: ScalarOptions
): FieldObservation {
  const goldEmpty = isEmpty(gold);
  const predEmpty = isEmpty(predicted);

  if (goldEmpty && predEmpty) {
    return { field, outcome: 'tn', similarity: null, gold, predicted, confidence: opts.confidence, errorCategory: null };
  }

  const otherGoldValues = opts.allGoldValues.filter((v) => normalizeText(v) !== normalizeText(gold));
  const classify = (): ErrorCategory =>
    classifyFieldError(gold, predicted, {
      otherGoldValues,
      scanned: opts.scanned,
      isDate: Boolean(opts.isDate),
      isFreeText: Boolean(opts.isFreeText),
    });

  if (goldEmpty !== predEmpty) {
    return {
      field,
      outcome: goldEmpty ? 'fp' : 'fn',
      similarity: null,
      gold,
      predicted,
      confidence: opts.confidence,
      errorCategory: classify(),
    };
  }

  const similarity = opts.similarity ? opts.similarity(gold, predicted) : null;
  const matched = opts.exact
    ? opts.exact(gold, predicted)
    : (similarity ?? 0) >= (opts.threshold ?? SHORT_FIELD_THRESHOLD);

  if (matched) {
    return { field, outcome: 'tp', similarity, gold, predicted, confidence: opts.confidence, errorCategory: null };
  }
  return {
    field,
    outcome: 'both',
    similarity,
    gold,
    predicted,
    confidence: opts.confidence,
    errorCategory: classify(),
  };
}

// ---------------------------------------------------------------------------
// Set-valued fields
// ---------------------------------------------------------------------------

function scoreSet(
  field: FieldKey,
  gold: string[],
  predicted: string[],
  threshold: number,
  ctx: {
    perItemConfidence: number[] | null;
    groupConfidence: number | null;
    allGoldValues: string[];
    scanned: boolean;
  }
): FieldObservation[] {
  const { matched, unmatchedGold, unmatchedPred } = matchSets(
    gold,
    predicted,
    shortFieldSimilarity,
    threshold
  );

  const confidenceFor = (predIndex: number): number | null =>
    ctx.perItemConfidence?.[predIndex] ?? ctx.groupConfidence ?? null;

  const out: FieldObservation[] = [];

  for (const m of matched) {
    out.push({
      field,
      outcome: 'tp',
      similarity: m.score,
      gold: gold[m.goldIndex],
      predicted: predicted[m.predIndex],
      confidence: confidenceFor(m.predIndex),
      errorCategory: null,
    });
  }

  // A skill the model did not return. There is no prediction, so there is no
  // confidence to record — a model cannot express uncertainty about something it
  // never mentioned, and imputing one would corrupt the calibration analysis.
  for (const g of unmatchedGold) {
    out.push({
      field,
      outcome: 'fn',
      similarity: null,
      gold: gold[g],
      predicted: '',
      confidence: null,
      errorCategory: 'MISSING_FIELD',
    });
  }

  for (const p of unmatchedPred) {
    out.push({
      field,
      outcome: 'fp',
      similarity: null,
      gold: '',
      predicted: predicted[p],
      confidence: confidenceFor(p),
      errorCategory: classifyFieldError('', predicted[p], {
        otherGoldValues: ctx.allGoldValues,
        scanned: ctx.scanned,
        isDate: false,
        isFreeText: false,
      }),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry lists
// ---------------------------------------------------------------------------

interface SubField<T> {
  key: FieldKey;
  pick: (entry: T) => string;
  kind: 'short' | 'org' | 'date' | 'free';
}

function scoreEntries<T extends { confidence?: number }>(args: {
  alignment: Alignment;
  entryKey: FieldKey;
  subFields: SubField<T>[];
  /** Ground-truth entries carry no confidence; the type is widened, not the data. */
  gold: Array<Omit<T, 'confidence'>>;
  predicted: T[];
  groupConfidence: number | null;
  shortThreshold: number;
  freeThreshold: number;
  allGoldValues: string[];
  scanned: boolean;
}): FieldObservation[] {
  const out: FieldObservation[] = [];
  const { alignment } = args;

  const splitGold = new Set(alignment.splits.map((s) => s.goldIndex));
  const mergeGold = new Set(alignment.merges.map((m) => m.goldIndex));
  const splitPred = new Set(alignment.splits.flatMap((s) => s.extraPredIndices));

  for (const pair of alignment.pairs) {
    const goldEntry = args.gold[pair.goldIndex] as T;
    const predEntry = args.predicted[pair.predIndex];
    const entryConfidence = predEntry.confidence ?? args.groupConfidence ?? null;

    out.push({
      field: args.entryKey,
      outcome: 'tp',
      similarity: pair.score,
      gold: describeEntry(args.subFields, goldEntry),
      predicted: describeEntry(args.subFields, predEntry),
      confidence: entryConfidence,
      // A gold entry matched *and* split still cost the user a duplicate row, so it
      // is flagged even though the entry itself counts as found.
      errorCategory: splitGold.has(pair.goldIndex) ? 'ENTRY_SPLIT' : null,
    });

    for (const sub of args.subFields) {
      out.push(
        scalar(sub.key, sub.pick(goldEntry), sub.pick(predEntry), {
          ...similarityFor(sub.kind, args.shortThreshold, args.freeThreshold),
          confidence: entryConfidence,
          allGoldValues: args.allGoldValues,
          scanned: args.scanned,
          isDate: sub.kind === 'date',
          isFreeText: sub.kind === 'free',
        })
      );
    }
  }

  for (const g of alignment.unmatchedGold) {
    out.push({
      field: args.entryKey,
      outcome: 'fn',
      similarity: null,
      gold: describeEntry(args.subFields, args.gold[g] as T),
      predicted: '',
      confidence: null,
      errorCategory: mergeGold.has(g) ? 'ENTRY_MERGE' : 'MISSED_ENTRY',
    });
    // Sub-fields of a missed entry are misses too. Without these, a system that
    // drops whole entries would be penalised once while a system that garbles every
    // field of an entry it *did* return would be penalised four times — which would
    // reward dropping data over reading it badly.
    for (const sub of args.subFields) {
      const value = sub.pick(args.gold[g] as T);
      if (isEmpty(value)) continue;
      out.push({
        field: sub.key,
        outcome: 'fn',
        similarity: null,
        gold: value,
        predicted: '',
        confidence: null,
        errorCategory: 'MISSING_FIELD',
      });
    }
  }

  for (const p of alignment.unmatchedPred) {
    const predEntry = args.predicted[p];
    out.push({
      field: args.entryKey,
      outcome: 'fp',
      similarity: null,
      gold: '',
      predicted: describeEntry(args.subFields, predEntry),
      confidence: predEntry.confidence ?? args.groupConfidence ?? null,
      errorCategory: splitPred.has(p) ? 'ENTRY_SPLIT' : 'SPURIOUS_ENTRY',
    });
  }

  return out;
}

function similarityFor(
  kind: SubField<unknown>['kind'],
  shortThreshold: number,
  freeThreshold: number
): Pick<ScalarOptions, 'similarity' | 'exact' | 'threshold'> {
  switch (kind) {
    case 'org':
      return { similarity: organizationSimilarity, threshold: shortThreshold };
    case 'date':
      return { exact: dateIntervalsMatch, similarity: shortFieldSimilarity };
    case 'free':
      return { similarity: freeTextSimilarity, threshold: freeThreshold };
    default:
      return { similarity: shortFieldSimilarity, threshold: shortThreshold };
  }
}

function describeEntry<T>(subFields: SubField<T>[], entry: T): string {
  return subFields
    .map((s) => s.pick(entry))
    .filter((v) => !isEmpty(v))
    .join(' | ');
}

function toAlignableExperience(e: {
  title: string;
  company: string;
  duration: string;
  description: string;
}): AlignableEntry {
  return { organization: e.company, label: e.title, date: e.duration, body: e.description };
}

function toAlignableEducation(e: {
  degree: string;
  institution: string;
  graduationDate: string;
}): AlignableEntry {
  return { organization: e.institution, label: e.degree, date: e.graduationDate, body: '' };
}

function collectGoldValues(truth: GroundTruthResume): string[] {
  return [
    truth.personal.name,
    truth.personal.email,
    truth.personal.phone,
    truth.personal.location,
    ...truth.skills,
    ...truth.certifications,
    ...truth.experience.flatMap((e) => [e.title, e.company, e.duration, e.description]),
    ...truth.education.flatMap((e) => [e.degree, e.institution, e.graduationDate]),
  ].filter((v) => !isEmpty(v));
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function emptyCounts(): Counts {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

export function tallyByField(observations: FieldObservation[]): Record<FieldKey, Counts> {
  const out = Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyCounts()])) as Record<FieldKey, Counts>;
  for (const o of observations) addOutcome(out[o.field], o.outcome);
  return out;
}

export function addOutcome(counts: Counts, outcome: Outcome): void {
  switch (outcome) {
    case 'tp':
      counts.tp += 1;
      break;
    case 'fp':
      counts.fp += 1;
      break;
    case 'fn':
      counts.fn += 1;
      break;
    case 'both':
      counts.fp += 1;
      counts.fn += 1;
      break;
    case 'tn':
      counts.tn += 1;
      break;
  }
}

export function addCounts(target: Counts, source: Counts): void {
  target.tp += source.tp;
  target.fp += source.fp;
  target.fn += source.fn;
  target.tn += source.tn;
}

export interface PrfMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
  counts: Counts;
}

export function prf(counts: Counts): PrfMetrics {
  const precision = counts.tp + counts.fp === 0 ? 1 : counts.tp / (counts.tp + counts.fp);
  const recall = counts.tp + counts.fn === 0 ? 1 : counts.tp / (counts.tp + counts.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, support: counts.tp + counts.fn, counts: { ...counts } };
}
