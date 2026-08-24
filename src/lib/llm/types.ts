/**
 * @fileOverview The provider-agnostic contract every parsing backend implements.
 *
 * The reason this abstraction exists is not portability for its own sake — it is
 * that the evaluation harness needs to hold everything constant except the model.
 * If Gemini and Groq are reached through different call sites with different
 * prompts and different retry behaviour, a difference in their scores is not
 * attributable to the model. One interface, one prompt builder, one retry policy;
 * the provider is the only thing that varies.
 *
 * A consequence worth stating explicitly: providers differ in *capability*, not
 * just quality. Gemini accepts a PDF or a scan directly. Llama 3.3 on Groq is
 * text-only, so a document has to be flattened to text first — by a PDF text layer
 * for born-digital files, by OCR for scans. That preprocessing step is part of the
 * system under test, and `ProviderResult.preprocessing` records which path a given
 * call took so the error analysis can separate "the model misread it" from "the OCR
 * never gave the model a chance".
 */

import type { ParsedResume } from '@/lib/resume-schema';

export type DocumentKind = 'pdf' | 'docx' | 'image';

export interface ResumeDocument {
  /** Stable identifier used as the response-cache key. */
  id: string;
  kind: DocumentKind;
  mimeType: string;
  /** Raw bytes. Providers that need a data URI build one; providers that need text extract it. */
  bytes: Uint8Array;
  /** Original filename, for logging only. */
  filename?: string;
}

export type PromptStrategy = 'zero-shot' | 'few-shot';

export interface ParseOptions {
  strategy: PromptStrategy;
  /**
   * How a PDF is flattened to text for providers that cannot read documents
   * natively. Part of `ParseOptions` rather than provider construction because it
   * is an experimental variable: the `groq-naive-pdf` arm exists to measure what
   * the column-aware preprocessor is worth, and that only works if the harness can
   * vary it per call while holding everything else fixed.
   */
  pdfStrategy?: 'naive' | 'column-aware';
  /** Overrides the provider's default model id. Used by the Gemini failover chain. */
  model?: string;
  /** Ask the model to emit per-field confidence. Off for ablations that isolate its cost. */
  requestConfidence?: boolean;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * True when the numbers came from the provider's own accounting; false when they
   * are our pessimistic character estimate. The cost table must say which, because
   * an estimated cost compared against a reported cost is not a comparison.
   */
  reported: boolean;
}

export interface PreprocessingInfo {
  /** How the document reached the model. */
  path: 'native-multimodal' | 'pdf-text-layer' | 'docx-text' | 'ocr';
  /** Characters of extracted text handed to the model (0 for the native path). */
  extractedChars: number;
  /** Characters actually sent after budget trimming. Lower than the above means data was cut. */
  sentChars: number;
  truncated: boolean;
  /** Wall-clock time spent before the LLM call, e.g. OCR. Kept out of model latency. */
  latencyMs: number;
}

export interface ProviderResult {
  parsed: ParsedResume;
  /** The provider id that actually produced this, after any failover. */
  providerId: string;
  /** The model id that actually produced this, after any failover. */
  modelId: string;
  usage: TokenUsage;
  /** LLM round-trip only. Preprocessing time is reported separately. */
  latencyMs: number;
  preprocessing: PreprocessingInfo;
  /** Non-fatal schema repairs applied to the raw reply. Empty means the model complied. */
  repairs: string[];
  /** Number of LLM round-trips, including retries and failover hops. */
  attempts: number;
  /** Providers/models tried and abandoned before this one succeeded. */
  failoverTrail: string[];
  /** Verbatim model reply, kept for the response cache and for manual inspection. */
  rawResponse?: string;
}

/**
 * Per-million-token prices, used for the cost column of the comparison table.
 * These are list prices at a point in time, not a bill — they are here so that an
 * accuracy gain can be expressed against what it costs, which is the comparison a
 * reviewer actually cares about.
 */
export interface PricingInfo {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: 'USD';
  /** ISO date the prices were checked. Stale pricing is worse than no pricing. */
  checkedOn: string;
  source: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  /** True if the provider accepts PDFs/images directly. False forces the text path. */
  readonly supportsNativeDocuments: boolean;
  readonly pricing: PricingInfo;
  /** False when the required API key is absent, so the harness can skip rather than fail. */
  isConfigured(): boolean;
  parse(document: ResumeDocument, options: ParseOptions): Promise<ProviderResult>;
}

export function estimatedCostUsd(usage: TokenUsage, pricing: PricingInfo): number {
  return (
    (usage.promptTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export function mimeToKind(mime: string): DocumentKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return 'docx';
}
