/**
 * @fileOverview Gemini provider, layered on the existing Genkit failover chain.
 *
 * The retry-and-fallback policy that shipped with this project is reused verbatim
 * rather than reimplemented: `executeWithRetryAndFallback` still walks
 * gemini-2.5-flash → 1.5-flash → 1.5-pro with exponential backoff. What is added
 * here is observation. The harness needs to know *which* model in the chain
 * actually produced a result and how many round-trips it took, because "2.5-flash
 * scores 0.91" is a different claim from "the chain scores 0.91 and silently fell
 * through to 1.5-pro on a fifth of the corpus". `failoverTrail` makes that visible
 * in every result row.
 *
 * Gemini reads the PDF or image directly, so there is no preprocessing step and no
 * token budget to enforce — the per-request context is orders of magnitude larger
 * than a resume. That asymmetry with the Groq path is the substance of the
 * comparison, not a gap in this implementation.
 */

import { ai, executeWithRetryAndFallback, isGeminiConfigured, GEMINI_MODEL_CHAIN } from '@/ai/genkit';
import { toDataUri } from '@/lib/llm/document';
import { ProviderError, classifyProviderError } from '@/lib/llm/errors';
import { buildSystemPrompt } from '@/lib/llm/prompts';
import type {
  LLMProvider,
  ParseOptions,
  PricingInfo,
  ProviderResult,
  ResumeDocument,
} from '@/lib/llm/types';
import { ParsedResumeSchema, coerceParsedResume } from '@/lib/resume-schema';

/**
 * List prices for gemini-2.5-flash at the date below (text/image input). Prices for
 * the 1.5 fallbacks differ; the cost column reports the model that actually served
 * the request, so a run that fell through to 1.5-pro is not costed as if it had not.
 */
const PRICING_BY_MODEL: Record<string, PricingInfo> = {
  'googleai/gemini-2.5-flash': {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://ai.google.dev/pricing',
  },
  'googleai/gemini-1.5-flash': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://ai.google.dev/pricing',
  },
  'googleai/gemini-1.5-pro': {
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://ai.google.dev/pricing',
  },
};

export function geminiPricingFor(model: string): PricingInfo {
  return PRICING_BY_MODEL[model] ?? PRICING_BY_MODEL['googleai/gemini-2.5-flash'];
}

export interface GeminiProviderOptions {
  model?: string;
  /** Disable the chain to measure a single model in isolation. */
  failover?: boolean;
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';
  readonly displayName = 'Google Gemini 2.5 Flash (multimodal)';
  readonly defaultModel: string;
  readonly supportsNativeDocuments = true;
  readonly pricing: PricingInfo;

  private readonly failover: boolean;

  constructor(opts: GeminiProviderOptions = {}) {
    this.defaultModel = opts.model ?? GEMINI_MODEL_CHAIN[0];
    this.failover = opts.failover !== false;
    this.pricing = geminiPricingFor(this.defaultModel);
  }

  isConfigured(): boolean {
    return isGeminiConfigured();
  }

  async parse(document: ResumeDocument, options: ParseOptions): Promise<ProviderResult> {
    if (!this.isConfigured()) {
      throw new ProviderError('GEMINI_API_KEY is not set.', { kind: 'auth', provider: this.id });
    }

    const { system } = buildSystemPrompt({
      strategy: options.strategy,
      requestConfidence: options.requestConfidence !== false,
      // Genkit constrains the output from the Zod schema itself, so inlining a
      // second copy of the schema into the prompt would only spend tokens and
      // introduce a way for the two to disagree.
      includeSchema: false,
    });

    const dataUri = toDataUri(document);
    const chain = options.model
      ? [options.model]
      : this.failover
        ? GEMINI_MODEL_CHAIN
        : [this.defaultModel];

    const attempts: Array<{ model: string; ok: boolean; error?: string }> = [];
    let servingModel = chain[0];
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
    let rawText = '';

    const started = Date.now();
    let output: unknown;
    try {
      output = await executeWithRetryAndFallback(
        async (modelName) => {
          servingModel = modelName;
          const response = await ai.generate({
            model: modelName,
            prompt: [{ text: system }, { media: { url: dataUri } }],
            output: { schema: ParsedResumeSchema },
            config: { temperature: 0 },
          });
          usage = (response.usage ?? {}) as typeof usage;
          rawText = safeText(response);
          return response.output;
        },
        {
          models: chain,
          onAttempt: (r) => attempts.push({ model: r.model, ok: r.ok, error: r.error }),
          // Credentials will not become valid by waiting, and a document will not
          // become smaller. Move to the next model rather than sleeping first.
          shouldRetry: (err) => {
            const kind = classifyProviderError(err, 'gemini').kind;
            return kind !== 'auth' && kind !== 'oversized';
          },
        }
      );
    } catch (err) {
      throw classifyProviderError(err, this.id);
    }
    const latencyMs = Date.now() - started;

    const { value: parsed, repaired } = coerceParsedResume(output);

    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;

    return {
      parsed,
      providerId: this.id,
      modelId: servingModel,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
        reported: promptTokens > 0 || completionTokens > 0,
      },
      latencyMs,
      preprocessing: {
        path: 'native-multimodal',
        extractedChars: 0,
        sentChars: 0,
        truncated: false,
        latencyMs: 0,
      },
      repairs: repaired,
      attempts: attempts.length || 1,
      // Every model tried and abandoned before the one that answered.
      failoverTrail: attempts.filter((a) => !a.ok).map((a) => a.model),
      rawResponse: rawText || undefined,
    };
  }
}

function safeText(response: unknown): string {
  const r = response as { text?: unknown };
  return typeof r?.text === 'string' ? r.text : '';
}
