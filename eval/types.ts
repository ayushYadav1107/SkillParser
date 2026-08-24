/**
 * @fileOverview The on-disk shape of an evaluation run.
 *
 * These types are the contract between three consumers with different needs: the
 * harness that writes runs, the report generator that renders them, and the public
 * `/eval` page that ships a summary to the browser. Keeping them in one file is
 * what stops the page from quietly rendering a field the harness stopped writing.
 *
 * Runs are append-only artifacts. A run is never edited after it is written — a
 * changed prompt or a changed model produces a *new* run with a new id, and the
 * comparison is between runs. That is what turns the eval from a script somebody
 * ran once into a record you can point at and say what changed and when.
 */

import type { Condition } from './corpus/generate';
import type { Counts, FieldKey, FieldObservation } from './metrics/score';
import type { ErrorCategory } from './metrics/errors';

export type PromptStrategy = 'zero-shot' | 'few-shot';
export type PdfStrategy = 'naive' | 'column-aware';

/** One experimental arm: everything that was held fixed for a set of documents. */
export interface ArmSpec {
  /** Stable slug, e.g. `groq-few-shot`. Used as the comparison key. */
  id: string;
  label: string;
  provider: string;
  /** Configured model. The *serving* model is recorded per document, after failover. */
  model: string;
  strategy: PromptStrategy;
  pdfStrategy: PdfStrategy;
  requestConfidence: boolean;
}

export type DocumentStatus = 'ok' | 'error' | 'skipped';

export interface DocumentResult {
  documentId: string;
  recordId: string;
  condition: Condition;
  layout: 'single-column' | 'two-column';
  modality: 'digital' | 'scanned';
  status: DocumentStatus;
  /** Set when status is not `ok`. */
  errorKind?: string;
  errorMessage?: string;
  /** LLM round-trip milliseconds. Excludes preprocessing. */
  latencyMs: number;
  /** OCR / text-extraction milliseconds. Reported separately on purpose. */
  preprocessingMs: number;
  preprocessingPath: string;
  promptTokens: number;
  completionTokens: number;
  /** False when token counts are our estimate rather than the provider's accounting. */
  tokensReported: boolean;
  costUsd: number;
  /** The model that actually answered, which may differ from the arm's configured model. */
  servingModel: string;
  failoverTrail: string[];
  repairs: string[];
  /** Whether the prompt had to be trimmed to fit the token budget. */
  promptTruncated: boolean;
  counts: Record<FieldKey, Counts>;
  observations: FieldObservation[];
  errorCategories: Partial<Record<ErrorCategory, number>>;
}

export interface RunMetadata {
  runId: string;
  startedAt: string;
  finishedAt: string;
  corpusSeed: number;
  corpusGeneratorVersion: string;
  harnessVersion: string;
  conditions: Condition[];
  documentCount: number;
  /** Free-text note supplied with `--note`, e.g. "after prompt v3". */
  note?: string;
}

export interface RunArtifact {
  metadata: RunMetadata;
  arms: Array<{ spec: ArmSpec; documents: DocumentResult[] }>;
}

export const HARNESS_VERSION = '1.0.0';
