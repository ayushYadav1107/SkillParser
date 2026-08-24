/**
 * @fileOverview The shape of the evaluation summary that ships to the browser.
 *
 * Lives under `src/` rather than `eval/` so the Next.js page can import the types
 * without dragging the harness — and its Node-only dependencies — into the client
 * bundle. `eval/report.ts` imports these same definitions, so the page and the
 * writer cannot drift apart.
 *
 * Deliberately excludes per-observation detail. The full run artifact is about a
 * megabyte per arm and belongs in the repository, not in a page load.
 */

export interface PublicArm {
  id: string;
  label: string;
  provider: string;
  model: string;
  strategy: string;
  pdfStrategy: string;
  microF1: number;
  microF1Lower: number;
  microF1Upper: number;
  macroF1: number;
  precision: number;
  recall: number;
  documentsScored: number;
  documentsFailed: number;
  documentsSkipped: number;
  failureReasons: Record<string, number>;
  perField: Array<{ field: string; precision: number; recall: number; f1: number; support: number }>;
  perGroup: Array<{ group: string; precision: number; recall: number; f1: number }>;
  byCondition: Array<{ label: string; f1: number; documents: number }>;
  errorCounts: Array<{ category: string; count: number; share: number; informational: boolean; description: string }>;
  calibration: {
    scored: number;
    unreported: number;
    ece: number;
    mce: number;
    brier: number;
    auroc: number;
    accuracy: number;
    meanConfidence: number;
    overconfident: boolean;
    bins: Array<{ lower: number; upper: number; count: number; meanConfidence: number; accuracy: number }>;
  };
  routing: Array<{ threshold: number; autoAcceptRate: number; autoAcceptAccuracy: number; errorsCaught: number }>;
  cost: {
    meanLatencyMs: number;
    p90LatencyMs: number;
    meanPreprocessingMs: number;
    meanPromptTokens: number;
    meanCompletionTokens: number;
    costPer1000ResumesUsd: number;
    allTokensReported: boolean;
  };
  truncatedPrompts: number;
  repairedReplies: number;
  failedOver: number;
}

export interface PublicComparison {
  baselineId: string;
  candidateId: string;
  delta: number;
  lower: number;
  upper: number;
  pValue: number;
  significant: boolean;
  latencyRatio: number;
  costRatio: number;
  droppedDocuments: number;
}

export interface PublicReport {
  runId: string;
  finishedAt: string;
  documentCount: number;
  corpusSeed: number;
  harnessVersion: string;
  note?: string;
  arms: PublicArm[];
  comparisons: PublicComparison[];
}
