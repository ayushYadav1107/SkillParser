/**
 * @fileOverview Turning per-document results into the numbers that get reported.
 *
 * Kept separate from the harness so that aggregation can be re-run over a stored
 * run without spending another API call. In practice that is how most of the
 * analysis happens: the expensive part is calling the models, and every subsequent
 * question — break it down by layout, sweep the match threshold, recompute the
 * calibration on a subset — is a pure function of an artifact already on disk.
 */

import { computeCalibration, routingCurve, type CalibrationPoint, type CalibrationReport, type RoutingOperatingPoint } from './metrics/calibration';
import { ERROR_DESCRIPTIONS, INFORMATIONAL_CATEGORIES, type ErrorCategory } from './metrics/errors';
import {
  FIELD_GROUPS,
  FIELD_KEYS,
  addCounts,
  emptyCounts,
  prf,
  type Counts,
  type FieldKey,
  type PrfMetrics,
} from './metrics/score';
import { bootstrapCustom, bootstrapMicroF1, pairedBootstrapF1, type Interval, type PairedComparison } from './metrics/stats';
import type { ArmSpec, DocumentResult, RunArtifact } from './types';

export interface FieldMetrics extends PrfMetrics {
  field: FieldKey;
  /** Mean continuous similarity over instances where both sides had a value. */
  meanSimilarity: number | null;
}

export interface SliceMetrics {
  label: string;
  documents: number;
  micro: PrfMetrics;
  microF1Interval: Interval;
}

export interface CostMetrics {
  documentsCosted: number;
  meanLatencyMs: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
  meanPreprocessingMs: number;
  meanPromptTokens: number;
  meanCompletionTokens: number;
  totalCostUsd: number;
  costPer1000ResumesUsd: number;
  /** False when any document's tokens were estimated rather than reported. */
  allTokensReported: boolean;
}

export interface ArmSummary {
  spec: ArmSpec;
  documentsAttempted: number;
  documentsScored: number;
  documentsFailed: number;
  documentsSkipped: number;
  failureReasons: Record<string, number>;
  /** Micro-averaged over every field instance. Dominated by the numerous fields. */
  micro: PrfMetrics;
  microF1Interval: Interval;
  /** Unweighted mean of the per-field F1s. Gives rare fields equal weight. */
  macroF1: number;
  macroF1Interval: Interval;
  perField: FieldMetrics[];
  perGroup: Array<{ group: string; micro: PrfMetrics }>;
  byCondition: SliceMetrics[];
  byLayout: SliceMetrics[];
  byModality: SliceMetrics[];
  errorCounts: Array<{ category: ErrorCategory; count: number; share: number; informational: boolean; description: string }>;
  calibration: CalibrationReport;
  routing: RoutingOperatingPoint[];
  cost: CostMetrics;
  /** Per-document pooled counts, keyed by document id. Feeds the paired tests. */
  perDocumentCounts: Record<string, Counts>;
  /** Documents where the prompt had to be trimmed to fit the token budget. */
  truncatedPrompts: number;
  /** Documents whose reply needed structural repair. */
  repairedReplies: number;
  /** Documents that fell through to a fallback model or provider. */
  failedOver: number;
}

export function summariseArm(spec: ArmSpec, documents: DocumentResult[]): ArmSummary {
  const scored = documents.filter((d) => d.status === 'ok');
  const failed = documents.filter((d) => d.status === 'error');
  const skipped = documents.filter((d) => d.status === 'skipped');

  const failureReasons: Record<string, number> = {};
  for (const d of [...failed, ...skipped]) {
    const key = d.errorKind ?? 'unknown';
    failureReasons[key] = (failureReasons[key] ?? 0) + 1;
  }

  // --- pooled counts -----------------------------------------------------
  const perField = Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyCounts()])) as Record<FieldKey, Counts>;
  const perDocumentCounts: Record<string, Counts> = {};

  for (const doc of scored) {
    const docTotal = emptyCounts();
    for (const key of FIELD_KEYS) {
      addCounts(perField[key], doc.counts[key] ?? emptyCounts());
      addCounts(docTotal, doc.counts[key] ?? emptyCounts());
    }
    perDocumentCounts[doc.documentId] = docTotal;
  }

  const pooled = emptyCounts();
  for (const key of FIELD_KEYS) addCounts(pooled, perField[key]);

  const documentCounts = Object.values(perDocumentCounts);

  // --- per-field ---------------------------------------------------------
  const similarityByField = new Map<FieldKey, number[]>();
  for (const doc of scored) {
    for (const o of doc.observations) {
      if (o.similarity == null) continue;
      if (!similarityByField.has(o.field)) similarityByField.set(o.field, []);
      similarityByField.get(o.field)!.push(o.similarity);
    }
  }

  const perFieldMetrics: FieldMetrics[] = FIELD_KEYS.map((field) => {
    const sims = similarityByField.get(field) ?? [];
    return {
      field,
      ...prf(perField[field]),
      meanSimilarity: sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null,
    };
  });

  // Macro over fields that actually occur in this corpus. Including a field with no
  // instances would contribute a vacuous F1 of 1.0 and inflate the macro average.
  const presentFields = perFieldMetrics.filter((f) => f.counts.tp + f.counts.fp + f.counts.fn > 0);
  const macroF1 = presentFields.length
    ? presentFields.reduce((a, f) => a + f.f1, 0) / presentFields.length
    : 0;

  // --- calibration -------------------------------------------------------
  const calibrationPoints: CalibrationPoint[] = [];
  let unreportedConfidence = 0;
  for (const doc of scored) {
    for (const o of doc.observations) {
      // A miss has no prediction, so there is nothing to have been confident about.
      if (o.outcome === 'fn' || o.outcome === 'tn') continue;
      if (o.confidence == null) {
        unreportedConfidence += 1;
        continue;
      }
      calibrationPoints.push({
        confidence: o.confidence,
        correct: o.outcome === 'tp',
        field: o.field,
      });
    }
  }

  // --- errors ------------------------------------------------------------
  const errorTotals = new Map<ErrorCategory, number>();
  for (const doc of documents) {
    for (const [category, count] of Object.entries(doc.errorCategories)) {
      const key = category as ErrorCategory;
      errorTotals.set(key, (errorTotals.get(key) ?? 0) + (count ?? 0));
    }
  }
  const countedErrors = [...errorTotals.entries()]
    .filter(([c]) => !INFORMATIONAL_CATEGORIES.includes(c))
    .reduce((a, [, n]) => a + n, 0);

  const errorCounts = [...errorTotals.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      share: countedErrors && !INFORMATIONAL_CATEGORIES.includes(category) ? count / countedErrors : 0,
      informational: INFORMATIONAL_CATEGORIES.includes(category),
      description: ERROR_DESCRIPTIONS[category],
    }));

  return {
    spec,
    documentsAttempted: documents.length,
    documentsScored: scored.length,
    documentsFailed: failed.length,
    documentsSkipped: skipped.length,
    failureReasons,
    micro: prf(pooled),
    microF1Interval: bootstrapMicroF1(documentCounts),
    macroF1,
    macroF1Interval: bootstrapCustom(scored, (sample) => macroOf(sample), { seed: 424242 }),
    perField: perFieldMetrics,
    perGroup: Object.entries(FIELD_GROUPS).map(([group, keys]) => {
      const c = emptyCounts();
      for (const k of keys) addCounts(c, perField[k]);
      return { group, micro: prf(c) };
    }),
    byCondition: sliceBy(scored, (d) => d.condition),
    byLayout: sliceBy(scored, (d) => d.layout),
    byModality: sliceBy(scored, (d) => d.modality),
    errorCounts,
    calibration: computeCalibration(calibrationPoints, unreportedConfidence),
    routing: routingCurve(calibrationPoints),
    cost: summariseCost(scored),
    perDocumentCounts,
    truncatedPrompts: scored.filter((d) => d.promptTruncated).length,
    repairedReplies: scored.filter((d) => d.repairs.length > 0).length,
    failedOver: scored.filter((d) => d.failoverTrail.length > 0).length,
  };
}

function macroOf(documents: DocumentResult[]): number {
  const perField = Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyCounts()])) as Record<FieldKey, Counts>;
  for (const doc of documents) {
    for (const key of FIELD_KEYS) addCounts(perField[key], doc.counts[key] ?? emptyCounts());
  }
  const present = FIELD_KEYS.map((k) => perField[k]).filter((c) => c.tp + c.fp + c.fn > 0);
  return present.length ? present.reduce((a, c) => a + prf(c).f1, 0) / present.length : 0;
}

function sliceBy(documents: DocumentResult[], key: (d: DocumentResult) => string): SliceMetrics[] {
  const groups = new Map<string, DocumentResult[]>();
  for (const d of documents) {
    const k = key(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, docs]) => {
      const pooled = emptyCounts();
      const perDocument: Counts[] = [];
      for (const d of docs) {
        const total = emptyCounts();
        for (const k of FIELD_KEYS) addCounts(total, d.counts[k] ?? emptyCounts());
        addCounts(pooled, total);
        perDocument.push(total);
      }
      return {
        label,
        documents: docs.length,
        micro: prf(pooled),
        microF1Interval: bootstrapMicroF1(perDocument),
      };
    });
}

function summariseCost(documents: DocumentResult[]): CostMetrics {
  if (documents.length === 0) {
    return {
      documentsCosted: 0,
      meanLatencyMs: 0,
      medianLatencyMs: 0,
      p90LatencyMs: 0,
      meanPreprocessingMs: 0,
      meanPromptTokens: 0,
      meanCompletionTokens: 0,
      totalCostUsd: 0,
      costPer1000ResumesUsd: 0,
      allTokensReported: true,
    };
  }
  const latencies = documents.map((d) => d.latencyMs).sort((a, b) => a - b);
  const totalCost = documents.reduce((a, d) => a + d.costUsd, 0);
  return {
    documentsCosted: documents.length,
    meanLatencyMs: mean(documents.map((d) => d.latencyMs)),
    medianLatencyMs: quantile(latencies, 0.5),
    // p90 rather than max: one retry storm should not define the latency profile,
    // but the tail is exactly what a queue backs up behind, so the mean alone lies.
    p90LatencyMs: quantile(latencies, 0.9),
    meanPreprocessingMs: mean(documents.map((d) => d.preprocessingMs)),
    meanPromptTokens: mean(documents.map((d) => d.promptTokens)),
    meanCompletionTokens: mean(documents.map((d) => d.completionTokens)),
    totalCostUsd: totalCost,
    costPer1000ResumesUsd: (totalCost / documents.length) * 1000,
    allTokensReported: documents.every((d) => d.tokensReported),
  };
}

export interface ArmComparison {
  baselineId: string;
  candidateId: string;
  microF1: PairedComparison;
  /** Latency and cost ratios, candidate ÷ baseline. */
  latencyRatio: number;
  costRatio: number;
  perField: Array<{ field: FieldKey; baselineF1: number; candidateF1: number; delta: number }>;
}

export function compareArms(baseline: ArmSummary, candidate: ArmSummary): ArmComparison {
  const toMap = (r: Record<string, Counts>) => new Map(Object.entries(r));
  return {
    baselineId: baseline.spec.id,
    candidateId: candidate.spec.id,
    microF1: pairedBootstrapF1(toMap(baseline.perDocumentCounts), toMap(candidate.perDocumentCounts)),
    latencyRatio: baseline.cost.meanLatencyMs ? candidate.cost.meanLatencyMs / baseline.cost.meanLatencyMs : 0,
    costRatio: baseline.cost.totalCostUsd ? candidate.cost.totalCostUsd / baseline.cost.totalCostUsd : 0,
    perField: FIELD_KEYS.map((field) => {
      const b = baseline.perField.find((f) => f.field === field)!;
      const c = candidate.perField.find((f) => f.field === field)!;
      return { field, baselineF1: b.f1, candidateF1: c.f1, delta: c.f1 - b.f1 };
    }).filter((row) => row.baselineF1 > 0 || row.candidateF1 > 0),
  };
}

export function summariseRun(run: RunArtifact): ArmSummary[] {
  return run.arms.map((arm) => summariseArm(arm.spec, arm.documents));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function quantile(sortedAscending: number[], q: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.floor(q * sortedAscending.length));
  return sortedAscending[index];
}
