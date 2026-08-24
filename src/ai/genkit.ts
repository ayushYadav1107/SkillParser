import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

/**
 * SECURITY NOTE
 * -------------
 * This file previously contained a literal Google AI API key, which is now in the
 * public git history of this repository. Rotate that key at
 * https://aistudio.google.com/apikey — deleting the line does not revoke it.
 * The key is read from the environment from here on.
 */
const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

export const ai = genkit({
  plugins: [googleAI(apiKey ? { apiKey } : {})],
  model: 'googleai/gemini-2.5-flash', // Default model
});

export function isGeminiConfigured(): boolean {
  return Boolean(apiKey);
}

/** Ordered failover chain. The first entry is the primary; the rest are fallbacks. */
export const GEMINI_MODEL_CHAIN = [
  'googleai/gemini-2.5-flash',
  'googleai/gemini-1.5-flash',
  'googleai/gemini-1.5-pro',
] as const;

export interface AttemptRecord {
  model: string;
  attempt: number;
  ok: boolean;
  error?: string;
}

export interface RetryOptions {
  /** Overrides the default Gemini chain. Used to fail over across providers. */
  models?: readonly string[];
  maxRetriesPerModel?: number;
  baseDelayMs?: number;
  /**
   * Called after every attempt, successful or not. The evaluation harness uses this
   * to record how many round-trips a result actually cost — a provider that only
   * succeeds on its third fallback is not the same result as one that succeeds
   * first try, and reporting them identically would hide a real reliability
   * difference behind an accuracy number.
   */
  onAttempt?: (record: AttemptRecord) => void;
  /** Return false to abandon a model immediately instead of burning its retries. */
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Executes an AI operation with exponential backoff and automatic fallback to
 * secondary models when the primary fails or hits rate limits.
 *
 * The original two-argument-free signature still works exactly as before —
 * `executeWithRetryAndFallback(op)` retries each model in `GEMINI_MODEL_CHAIN`
 * three times with exponential backoff. The options bag is additive, and exists so
 * that (a) the eval harness can observe attempts, and (b) the provider registry can
 * reuse this same policy when failing over from Gemini to another provider, rather
 * than reimplementing backoff a second time and having the two drift apart.
 */
export async function executeWithRetryAndFallback<T>(
  operation: (modelName: string) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const models = options.models ?? GEMINI_MODEL_CHAIN;
  const maxRetriesPerModel = options.maxRetriesPerModel ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown = null;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
      try {
        console.log(`[Genkit] Generating with model ${model} (Attempt ${attempt + 1})`);
        const result = await operation(model);
        options.onAttempt?.({ model, attempt: attempt + 1, ok: true });
        return result;
      } catch (error: any) {
        lastError = error;
        const message = error?.message ?? String(error);
        console.error(`[Genkit] Error with model ${model} (Attempt ${attempt + 1}):`, message);
        options.onAttempt?.({ model, attempt: attempt + 1, ok: false, error: message });

        // A permanently-failing request (bad credentials, oversized input) should
        // move on rather than sleep through three doublings first.
        if (options.shouldRetry && !options.shouldRetry(error)) {
          console.log(`[Genkit] Error is not retryable for ${model}, switching to next model...`);
          break;
        }

        if (attempt === maxRetriesPerModel - 1) {
          console.log(`[Genkit] Exhausted retries for ${model}, switching to next model...`);
          break;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[Genkit] Waiting ${Math.round(delayMs)}ms before retrying...`);
        await sleep(delayMs);
      }
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(
    `All AI models and retries exhausted due to rate limits or errors. Please try again later.${detail}`
  );
}
