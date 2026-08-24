/**
 * @fileOverview Groq provider (OpenAI-compatible chat completions).
 *
 * One class, two paths, because Groq's catalogue splits along exactly the line the
 * experiment cares about.
 *
 * **The text path** flattens the document first — PDF text layer for born-digital
 * files, OCR for scans — and sends the result to a text model. **The vision path**
 * sends a scanned page to a multimodal model as an image and lets the model do its
 * own reading. Configure a vision model and image documents take the second path;
 * leave it unset and everything takes the first.
 *
 * That switch is the whole modality ablation. A multimodal model reading a scan and
 * a text model reading OCR output *of the same scan* are not doing the same task,
 * and averaging them into one number hides the most interesting result in the
 * comparison. Running both inside one vendor — same endpoint, same retry policy,
 * same prompt — is a cleaner experiment than comparing across vendors was, because
 * the model and the modality are the only things left varying.
 *
 * The other thing that makes this provider different: **it is screened on
 * `prompt_tokens + max_tokens`.** Groq rejects the request up front if the prompt
 * plus the reply reservation exceeds the per-minute ceiling, which on the free tier
 * is 8K for every model in the table. A multi-page resume plus few-shot exemplars
 * plus the JSON schema clears that easily. `budget.ts` trims to fit before the call,
 * and — critically — an oversized request is classified as *non-retryable*. Waiting
 * cannot make a request smaller, so retrying a 413 with backoff spends the entire
 * retry budget and then fails with the same error, minutes later, having looked
 * like a rate limit the whole time.
 *
 * Model IDs are configuration, not constants. Groq's catalogue churns hard — the
 * Llama 4 models and both Llama 3.2 vision previews were shut down within a year —
 * so every id here is an env-overridable default and `listGroqModels()` exists to
 * check what a given key can actually see rather than guessing.
 */

import {
  estimateTokens,
  fitSections,
  promptCharBudget,
} from '@/lib/llm/budget';
import { extractDocumentText, toDataUri } from '@/lib/llm/document';
import {
  CapabilityUnavailableError,
  PromptTooLargeError,
  ProviderError,
  classifyProviderError,
} from '@/lib/llm/errors';
import { buildSystemPrompt } from '@/lib/llm/prompts';
import type {
  LLMProvider,
  ParseOptions,
  PricingInfo,
  ProviderResult,
  ResumeDocument,
} from '@/lib/llm/types';
import { coerceParsedResume } from '@/lib/resume-schema';

const BASE_URL = 'https://api.groq.com/openai/v1';
const ENDPOINT = `${BASE_URL}/chat/completions`;
const MODELS_ENDPOINT = `${BASE_URL}/models`;

/**
 * Text model. `openai/gpt-oss-120b` rather than a Llama: it is in Groq's production
 * table, carries a 131K context, and is the model Groq's own deprecation notice
 * points Llama 4 users at. `llama-3.3-70b-versatile` still has a docs page but is
 * absent from both the production model table and the rate-limit table as of the
 * date below, which is not a foundation to default onto.
 */
export const DEFAULT_TEXT_MODEL = 'openai/gpt-oss-120b';

/**
 * Vision model. `qwen/qwen3.6-27b` is the *only* image-capable model Groq exposes —
 * the Llama 3.2 vision previews were retired in April 2025 and Llama 4 Scout and
 * Maverick were shut down in 2026. It is listed as **preview**, so it may be
 * withdrawn at short notice; when it is, the vision arm degrades to "unconfigured"
 * and the run continues with the text arms rather than failing.
 */
export const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';

/**
 * Free-tier ceiling, verified August 2026: 30 RPM / 8,000 TPM / 200,000 TPD, and
 * the same 8K TPM applies to every model in the table — dropping to a smaller model
 * buys no headroom. Limits are per-organisation with stated exceptions, so this is a
 * default rather than a fact. Check yours at https://console.groq.com/settings/limits
 * and override with GROQ_TPM_LIMIT.
 */
const DEFAULT_TPM_LIMIT = 8_000;
const DEFAULT_COMPLETION_TOKENS = 2_000;
const MAX_RETRIES = 4;

/**
 * List prices at the date below, per million tokens. Present so an accuracy delta
 * can be read against what it costs; not a bill. Override per model as Groq's
 * pricing page changes.
 */
const PRICING_BY_MODEL: Record<string, PricingInfo> = {
  'openai/gpt-oss-120b': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.75,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://groq.com/pricing',
  },
  'openai/gpt-oss-20b': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://groq.com/pricing',
  },
  'qwen/qwen3.6-27b': {
    inputPerMillion: 0.2,
    outputPerMillion: 0.8,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://groq.com/pricing',
  },
  'llama-3.3-70b-versatile': {
    inputPerMillion: 0.59,
    outputPerMillion: 0.79,
    currency: 'USD',
    checkedOn: '2026-08-24',
    source: 'https://groq.com/pricing',
  },
};

const UNKNOWN_PRICING: PricingInfo = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  currency: 'USD',
  checkedOn: '2026-08-24',
  // A zero here would silently report a free model. The report prints the source
  // string, so an unpriced model is visible as unpriced rather than as free.
  source: 'unknown model — cost not priced; add it to PRICING_BY_MODEL',
};

export function groqPricingFor(model: string): PricingInfo {
  return PRICING_BY_MODEL[model] ?? UNKNOWN_PRICING;
}

/**
 * Asks the API what this key can actually see.
 *
 * Groq retires models faster than most providers and the failure mode is a 404 in
 * the middle of a long evaluation run. `npm run groq:check` calls this so the answer
 * arrives before the run rather than forty documents into it.
 */
export async function listGroqModels(apiKey = process.env.GROQ_API_KEY ?? ''): Promise<string[]> {
  if (!apiKey) throw new ProviderError('GROQ_API_KEY is not set.', { kind: 'auth', provider: 'groq' });
  const response = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) {
    throw classifyProviderError(
      new Error(await response.text().catch(() => response.statusText)),
      'groq',
      response.status
    );
  }
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).sort();
}

export interface GroqProviderOptions {
  apiKey?: string;
  /** Text model, used for PDFs, DOCX, and for scans when no vision model is set. */
  model?: string;
  /**
   * Image-capable model. When set, image documents are sent to it directly instead
   * of being routed through OCR. Leave undefined for a strictly text-only provider.
   */
  visionModel?: string;
  /** Distinguishes the two registry entries in logs and reports. */
  id?: string;
  displayName?: string;
  tpmLimit?: number;
  completionTokens?: number;
  /** Injected by the tests so the retry and budget logic can be driven without a network. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class GroqProvider implements LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly visionModel?: string;
  readonly supportsNativeDocuments: boolean;
  readonly pricing: PricingInfo;

  private readonly apiKey: string;
  private readonly tpmLimit: number;
  private readonly completionTokens: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GroqProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GROQ_API_KEY ?? '';
    this.defaultModel = opts.model ?? process.env.GROQ_MODEL ?? DEFAULT_TEXT_MODEL;
    this.visionModel = opts.visionModel;
    this.id = opts.id ?? 'groq';
    this.displayName =
      opts.displayName ??
      (this.visionModel
        ? `Groq · ${this.visionModel} (vision) + ${this.defaultModel} (text)`
        : `Groq · ${this.defaultModel}`);
    // "Native" here means images specifically. PDFs still go through text
    // extraction on both paths — no Groq model reads a PDF container directly.
    this.supportsNativeDocuments = Boolean(this.visionModel);
    this.pricing = groqPricingFor(this.defaultModel);
    this.tpmLimit = opts.tpmLimit ?? numberFromEnv('GROQ_TPM_LIMIT', DEFAULT_TPM_LIMIT);
    this.completionTokens =
      opts.completionTokens ?? numberFromEnv('RESUME_COMPLETION_TOKENS', DEFAULT_COMPLETION_TOKENS);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async parse(document: ResumeDocument, options: ParseOptions): Promise<ProviderResult> {
    if (!this.isConfigured()) {
      throw new ProviderError('GROQ_API_KEY is not set.', { kind: 'auth', provider: this.id });
    }

    const useVision = Boolean(this.visionModel) && document.kind === 'image';
    return useVision ? this.parseWithVision(document, options) : this.parseWithText(document, options);
  }

  // -------------------------------------------------------------------------
  // Vision path: the model looks at the page.
  // -------------------------------------------------------------------------

  private async parseWithVision(
    document: ResumeDocument,
    options: ParseOptions
  ): Promise<ProviderResult> {
    // `options.model` deliberately does not apply here: it is the arm's *text*
    // model, and routing an image to a text model produces a confusing 400 rather
    // than a useful result. The vision model comes from provider configuration.
    const model = this.visionModel!;
    const requestConfidence = options.requestConfidence !== false;

    const { system } = buildSystemPrompt({
      strategy: options.strategy,
      requestConfidence,
      includeSchema: true,
    });

    // An image costs tokens too, and the provider counts them against the same
    // per-minute ceiling as text. The budget check still has to happen — it just
    // has nothing left to trim, because you cannot truncate half a page away and
    // still call the result a reading of the document. If the instructions alone
    // do not fit, that is a configuration error and it is raised as one.
    const overhead = estimateTokens(system);
    if (overhead + this.completionTokens >= this.tpmLimit * 0.95) {
      throw new PromptTooLargeError(
        `The instruction prompt (~${overhead} tokens) plus a ${this.completionTokens}-token reply reservation leaves no room for an image under the ${this.tpmLimit} TPM ceiling. Lower RESUME_COMPLETION_TOKENS, use zero-shot instead of few-shot, or raise GROQ_TPM_LIMIT.`,
        { provider: this.id, limitTokens: this.tpmLimit }
      );
    }

    const started = Date.now();
    const { body, attempts } = await this.callWithRetry({
      model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Parse the resume in this image into the JSON object described above. It is a scan, so expect skew, noise and compression artefacts; read what is there and report low confidence on anything you had to reconstruct.',
            },
            { type: 'image_url', image_url: { url: toDataUri(document) } },
          ],
        },
      ],
      max_tokens: this.completionTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const latencyMs = Date.now() - started;

    return this.buildResult({
      body,
      attempts,
      model,
      latencyMs,
      preprocessing: {
        path: 'native-multimodal',
        extractedChars: 0,
        sentChars: 0,
        truncated: false,
        latencyMs: 0,
      },
      promptCharsForEstimate: system.length,
    });
  }

  // -------------------------------------------------------------------------
  // Text path: the document is flattened first.
  // -------------------------------------------------------------------------

  private async parseWithText(
    document: ResumeDocument,
    options: ParseOptions
  ): Promise<ProviderResult> {
    const model = options.model ?? this.defaultModel;
    const requestConfidence = options.requestConfidence !== false;

    // --- preprocess -------------------------------------------------------
    let extracted;
    try {
      extracted = await extractDocumentText(document, {
        pdfStrategy: options.pdfStrategy ?? 'column-aware',
      });
    } catch (err) {
      if (err instanceof CapabilityUnavailableError) throw err;
      throw classifyProviderError(err, this.id);
    }

    // --- budget -----------------------------------------------------------
    const { system } = buildSystemPrompt({
      strategy: options.strategy,
      requestConfidence,
      includeSchema: true,
    });

    const budget = promptCharBudget({
      tpmLimit: this.tpmLimit,
      replyTokens: this.completionTokens,
      fixedOverheadTokens: estimateTokens(system),
    });

    if (budget.charBudget <= 0) {
      throw new PromptTooLargeError(
        `The instruction prompt alone (~${estimateTokens(system)} tokens) plus a ${this.completionTokens}-token reply reservation exceeds the ${this.tpmLimit} TPM ceiling. Lower RESUME_COMPLETION_TOKENS or raise GROQ_TPM_LIMIT.`,
        { provider: this.id, limitTokens: this.tpmLimit }
      );
    }

    // The top of a resume carries the fields with unambiguous right answers —
    // name, email, phone, location — so it earns a larger share per character than
    // the body. Weights set the initial split; whatever the header does not use is
    // handed back to the body rather than wasted.
    const HEADER_CHARS = 900;
    const fitted = fitSections(
      [
        { label: 'RESUME (header)', value: extracted.text.slice(0, HEADER_CHARS), weight: 6 },
        { label: 'RESUME (body)', value: extracted.text.slice(HEADER_CHARS), weight: 4 },
      ],
      budget.charBudget
    );

    const documentText = fitted.sections
      .filter((s) => s.value.length > 0)
      .map((s) => s.value)
      .join('\n');

    const userMessage =
      `Parse the resume below into the JSON object described above.\n\n` +
      `--- BEGIN RESUME (${describeSource(extracted.path)}) ---\n${documentText}\n--- END RESUME ---`;

    // --- call -------------------------------------------------------------
    const started = Date.now();
    const { body, attempts } = await this.callWithRetry({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
      max_tokens: this.completionTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const latencyMs = Date.now() - started;

    return this.buildResult({
      body,
      attempts,
      model,
      latencyMs,
      preprocessing: {
        path: extracted.path,
        extractedChars: extracted.text.length,
        sentChars: documentText.length,
        truncated: fitted.anyTruncated,
        latencyMs: extracted.latencyMs,
      },
      promptCharsForEstimate: system.length + userMessage.length,
    });
  }

  /** Shared response handling, so the two paths cannot drift in how they report. */
  private buildResult(args: {
    body: any;
    attempts: number;
    model: string;
    latencyMs: number;
    preprocessing: ProviderResult['preprocessing'];
    promptCharsForEstimate: number;
  }): ProviderResult {
    const content: string = args.body?.choices?.[0]?.message?.content ?? '';
    const { value: parsed, repaired } = coerceParsedResume(safeJsonParse(content));

    const reportedPrompt = args.body?.usage?.prompt_tokens;
    const reportedCompletion = args.body?.usage?.completion_tokens;
    const reported = typeof reportedPrompt === 'number' && typeof reportedCompletion === 'number';

    const estimatedPrompt = Math.ceil(args.promptCharsForEstimate / 3);
    const estimatedCompletion = estimateTokens(content);

    return {
      parsed,
      providerId: this.id,
      modelId: args.model,
      usage: reported
        ? {
            promptTokens: reportedPrompt,
            completionTokens: reportedCompletion,
            totalTokens: args.body.usage.total_tokens ?? reportedPrompt + reportedCompletion,
            reported: true,
          }
        : {
            promptTokens: estimatedPrompt,
            completionTokens: estimatedCompletion,
            totalTokens: estimatedPrompt + estimatedCompletion,
            reported: false,
          },
      latencyMs: args.latencyMs,
      preprocessing: args.preprocessing,
      repairs: repaired,
      attempts: args.attempts,
      failoverTrail: [],
      rawResponse: content,
    };
  }

  /**
   * One call with bounded retries.
   *
   * The ordering inside the catch is the point of this method: oversized is
   * checked and rethrown before anything reaches the backoff path. Groq's own
   * wording for a 413 is `Request too large for model ... on tokens per minute
   * (TPM): Limit 8000, Requested 11269` — it contains the phrase "tokens per
   * minute", so a rate-limit rule that ran first would match it and retry a
   * request that can never succeed.
   */
  private async callWithRetry(payload: Record<string, unknown>): Promise<{ body: any; attempts: number }> {
    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          throw classifyProviderError(new Error(text || `HTTP ${response.status}`), this.id, response.status);
        }
        return { body: await response.json(), attempts: attempt };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : classifyProviderError(err, this.id);
        if (!pe.retryable) throw pe;
        lastError = pe;
        if (attempt === MAX_RETRIES) break;

        // Prefer the provider's own hint; it knows when the window resets.
        const waitMs = pe.retryAfterSeconds
          ? pe.retryAfterSeconds * 1000
          : Math.min(60_000, 1_000 * 2 ** attempt + Math.random() * 500);
        await this.sleep(waitMs);
      }
    }

    throw lastError ?? new ProviderError('Groq request failed.', { kind: 'unknown', provider: this.id });
  }
}

function describeSource(path: string): string {
  if (path === 'ocr') return 'transcribed from a scanned image by OCR; expect character-level noise';
  if (path === 'pdf-text-layer') return 'extracted from a PDF text layer';
  return 'extracted from a DOCX file';
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // Models occasionally prepend a sentence before the object despite being told not to.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

function numberFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
