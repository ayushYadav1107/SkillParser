/**
 * @fileOverview Confidence calibration.
 *
 * Asking a model for a confidence score is easy. The question worth answering is
 * whether that number means anything, and there are two distinct ways it can be
 * useful that are constantly conflated:
 *
 *   - **Discrimination** — do higher-confidence extractions turn out right more
 *     often than lower-confidence ones? Measured by AUROC: the probability that a
 *     randomly chosen correct extraction was scored above a randomly chosen wrong
 *     one. 0.5 is a coin flip; anything meaningfully above it means the confidence
 *     carries usable ranking signal.
 *   - **Calibration** — when the model says 0.8, is it right about 80% of the time?
 *     Measured by expected calibration error (ECE) and the reliability table.
 *
 * These come apart in practice, and the distinction decides what you can build. A
 * model that reports 0.95 on everything but is right 99% of the time on the values
 * it scores 0.97 and 85% on the ones it scores 0.93 has terrible calibration and
 * excellent discrimination — its numbers are useless as probabilities but perfectly
 * good for routing the bottom decile to human review, which is the actual product
 * requirement. A single "is it calibrated" verdict would throw that away.
 *
 * Two things are deliberately excluded from the denominator:
 *
 *   - **Field instances with no reported confidence.** They are counted and
 *     reported as `unreported`, never imputed. Substituting a default would
 *     manufacture the very signal being measured.
 *   - **Misses (`fn` with no prediction).** A model cannot express uncertainty
 *     about a field it never mentioned. Including them would score every miss as a
 *     maximally overconfident error and drag ECE toward a number that describes the
 *     imputation rather than the model.
 */

export interface CalibrationPoint {
  confidence: number;
  correct: boolean;
  /** Field key, so the report can break calibration down by field type. */
  field: string;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
  /** accuracy − meanConfidence. Negative means overconfident. */
  gap: number;
}

export interface CalibrationReport {
  /** Instances that carried a confidence score and could be scored right or wrong. */
  scored: number;
  /** Predictions whose provider returned no confidence for them. */
  unreported: number;
  bins: ReliabilityBin[];
  /** Expected calibration error: support-weighted mean |accuracy − confidence|. */
  ece: number;
  /** Maximum calibration error over non-empty bins. */
  mce: number;
  /** Brier score: mean squared error of the confidence as a probability. */
  brier: number;
  /** AUROC of confidence as a discriminator of correctness. */
  auroc: number;
  meanConfidence: number;
  accuracy: number;
  /** True when the model is systematically more confident than it is right. */
  overconfident: boolean;
  byField: Record<string, { scored: number; ece: number; auroc: number; accuracy: number; meanConfidence: number }>;
}

export const DEFAULT_BINS = 10;

export function computeCalibration(
  points: CalibrationPoint[],
  unreported: number,
  binCount = DEFAULT_BINS
): CalibrationReport {
  const core = computeCore(points, unreported, binCount);
  const byField: CalibrationReport['byField'] = {};
  for (const field of new Set(points.map((p) => p.field))) {
    const subset = points.filter((p) => p.field === field);
    // Note the call to computeCore, not computeCalibration: the per-field breakdown
    // must not recurse into computing its own per-field breakdown.
    const sub = computeCore(subset, 0, binCount);
    byField[field] = {
      scored: subset.length,
      ece: sub.ece,
      auroc: sub.auroc,
      accuracy: sub.accuracy,
      meanConfidence: sub.meanConfidence,
    };
  }
  return { ...core, byField };
}

type CalibrationCore = Omit<CalibrationReport, 'byField'>;

function computeCore(
  points: CalibrationPoint[],
  unreported: number,
  binCount: number
): CalibrationCore {
  const scored = points.length;
  if (scored === 0) {
    return {
      scored: 0,
      unreported,
      bins: [],
      ece: 0,
      mce: 0,
      brier: 0,
      auroc: 0.5,
      meanConfidence: 0,
      accuracy: 0,
      overconfident: false,
    };
  }

  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < binCount; i += 1) {
    const lower = i / binCount;
    const upper = (i + 1) / binCount;
    // Half-open bins, with the last one closed so that confidence exactly 1.0 has
    // somewhere to go. Dropping it would silently discard the most common value
    // some models emit.
    const inBin = points.filter((p) =>
      i === binCount - 1 ? p.confidence >= lower && p.confidence <= upper : p.confidence >= lower && p.confidence < upper
    );
    const count = inBin.length;
    const meanConfidence = count ? mean(inBin.map((p) => p.confidence)) : 0;
    const accuracy = count ? inBin.filter((p) => p.correct).length / count : 0;
    bins.push({ lower, upper, count, meanConfidence, accuracy, gap: accuracy - meanConfidence });
  }

  const ece = bins.reduce((a, b) => a + (b.count / scored) * Math.abs(b.gap), 0);
  const mce = Math.max(...bins.filter((b) => b.count > 0).map((b) => Math.abs(b.gap)), 0);
  const brier = mean(points.map((p) => (p.confidence - (p.correct ? 1 : 0)) ** 2));
  const meanConfidence = mean(points.map((p) => p.confidence));
  const accuracy = points.filter((p) => p.correct).length / scored;

  return {
    scored,
    unreported,
    bins,
    ece,
    mce,
    brier,
    auroc: auroc(points),
    meanConfidence,
    accuracy,
    overconfident: meanConfidence > accuracy,
  };
}

/**
 * AUROC via the rank-sum identity, with ties given their average rank.
 *
 * Tie handling matters more here than it usually does: models cluster their
 * confidence output on a handful of round values (0.9, 0.95, 0.99), so ties are the
 * common case rather than an edge case. Breaking them arbitrarily would make the
 * result depend on the order the observations happened to arrive in.
 */
export function auroc(points: CalibrationPoint[]): number {
  const positives = points.filter((p) => p.correct).length;
  const negatives = points.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;

  const sorted = [...points].sort((a, b) => a.confidence - b.confidence);
  const ranks = new Array<number>(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].confidence === sorted[i].confidence) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = averageRank;
    i = j + 1;
  }

  let rankSumPositive = 0;
  for (let k = 0; k < sorted.length; k += 1) if (sorted[k].correct) rankSumPositive += ranks[k];

  return (rankSumPositive - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * The practical question a calibration report should answer: if we auto-accept
 * everything above a confidence threshold and route the rest to a human, what
 * accuracy do we get and how much work do we save?
 */
export interface RoutingOperatingPoint {
  threshold: number;
  /** Share of predictions that clear the threshold. */
  autoAcceptRate: number;
  /** Accuracy among the auto-accepted. */
  autoAcceptAccuracy: number;
  /** Errors per hundred auto-accepted extractions. The number that gets escalated. */
  errorsPer100Accepted: number;
  /** Share of all errors that the threshold successfully diverts to review. */
  errorsCaught: number;
}

export function routingCurve(
  points: CalibrationPoint[],
  thresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
): RoutingOperatingPoint[] {
  const totalErrors = points.filter((p) => !p.correct).length;
  return thresholds.map((threshold) => {
    const accepted = points.filter((p) => p.confidence >= threshold);
    const acceptedCorrect = accepted.filter((p) => p.correct).length;
    const acceptedErrors = accepted.length - acceptedCorrect;
    const accuracy = accepted.length ? acceptedCorrect / accepted.length : 1;
    return {
      threshold,
      autoAcceptRate: points.length ? accepted.length / points.length : 0,
      autoAcceptAccuracy: accuracy,
      errorsPer100Accepted: accepted.length ? (acceptedErrors / accepted.length) * 100 : 0,
      errorsCaught: totalErrors ? (totalErrors - acceptedErrors) / totalErrors : 1,
    };
  });
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
