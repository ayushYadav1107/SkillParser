/**
 * @fileOverview Provider selection and failover.
 *
 * The original chain walked Gemini model versions: 2.5-flash → 1.5-flash → 1.5-pro.
 * That covers a bad model deployment but not a bad *account* — an exhausted quota,
 * a revoked key, or a regional outage takes down all three at once, because they
 * share a key and an endpoint. This module extends the same policy outward: past a
 * dead model to a different model family, and finally into the rule-based parser,
 * which cannot fail because it never leaves the machine.
 *
 * The default chain is Groq-first. `groq-vision` handles scans with a multimodal
 * model; `groq` handles everything else (and scans too, via OCR, when the vision
 * model is unavailable); `heuristic` is the floor. Gemini is still implemented and
 * still works — it is simply not in the default chain and reports itself
 * unconfigured without a key, so nothing breaks by its absence. Put `gemini` back
 * in `RESUME_PROVIDER_CHAIN` to use it.
 *
 * The last hop is a deliberate product decision worth stating: a user who uploads a
 * resume during an outage gets a degraded extraction rather than an error page, and
 * `degraded: true` in the response tells the UI to say so. Silently serving regex
 * output as if it were model output would be the wrong trade.
 */

import { ProviderError, classifyProviderError } from '@/lib/llm/errors';
import type { LLMProvider, ParseOptions, ProviderResult, ResumeDocument } from '@/lib/llm/types';

export type ProviderId = 'groq' | 'groq-vision' | 'gemini' | 'heuristic';

/**
 * Providers are constructed through dynamic imports rather than top-level ones.
 *
 * The Gemini provider pulls in the whole Genkit runtime, and a static import would
 * drag that into every consumer of this module — including the offline rule-based
 * arm of the eval harness, which has no business loading an LLM SDK, and a machine
 * with no API keys where the import is pure cost. Lazy loading keeps the dependency
 * where it is used.
 */
const FACTORIES: Record<ProviderId, () => Promise<LLMProvider>> = {
  groq: async () => new (await import('@/lib/llm/providers/groq')).GroqProvider(),
  'groq-vision': async () => {
    const mod = await import('@/lib/llm/providers/groq');
    return new mod.GroqProvider({
      id: 'groq-vision',
      visionModel: process.env.GROQ_VISION_MODEL ?? mod.DEFAULT_VISION_MODEL,
    });
  },
  gemini: async () => new (await import('@/lib/llm/providers/gemini')).GeminiProvider(),
  heuristic: async () => new (await import('@/lib/llm/providers/heuristic')).HeuristicProvider(),
};

const cache = new Map<ProviderId, LLMProvider>();

export async function getProvider(id: ProviderId): Promise<LLMProvider> {
  const existing = cache.get(id);
  if (existing) return existing;
  const factory = FACTORIES[id];
  if (!factory) throw new Error(`Unknown provider "${id}". Known: ${Object.keys(FACTORIES).join(', ')}`);
  const provider = await factory();
  cache.set(id, provider);
  return provider;
}

export function listProviderIds(): ProviderId[] {
  return Object.keys(FACTORIES) as ProviderId[];
}

/** Test seam so the offline suite can register a stub without touching the network. */
export function __registerProvider(id: string, provider: LLMProvider): void {
  (FACTORIES as Record<string, () => Promise<LLMProvider>>)[id] = async () => provider;
  cache.delete(id as ProviderId);
}

/**
 * Reads the configured chain. `RESUME_PROVIDER_CHAIN=groq,gemini` flips the primary
 * without a code change, which is what makes the A/B arms of the eval a config
 * difference rather than a branch.
 */
const DEFAULT_CHAIN: ProviderId[] = ['groq-vision', 'groq', 'heuristic'];

export function defaultProviderChain(): ProviderId[] {
  const raw = process.env.RESUME_PROVIDER_CHAIN;
  if (!raw) return [...DEFAULT_CHAIN];
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderId => s in FACTORIES);
  return ids.length ? ids : [...DEFAULT_CHAIN];
}

export interface FailoverResult extends ProviderResult {
  /** True when every LLM provider failed and the rule-based parser answered instead. */
  degraded: boolean;
}

/**
 * Walks the provider chain, skipping providers that are not configured and
 * abandoning ones that fail. Each provider still runs its own internal retry and
 * model-level failover first; this is strictly the outer loop.
 */
export async function parseWithFailover(
  document: ResumeDocument,
  options: ParseOptions,
  chain: ProviderId[] = defaultProviderChain()
): Promise<FailoverResult> {
  const trail: string[] = [];
  let lastError: unknown = null;

  for (const id of chain) {
    const provider = await getProvider(id);

    if (!provider.isConfigured()) {
      trail.push(`${id}:unconfigured`);
      continue;
    }

    try {
      const result = await provider.parse(document, options);
      return {
        ...result,
        failoverTrail: [...trail, ...result.failoverTrail],
        degraded: id === 'heuristic' && chain.length > 1,
      };
    } catch (err) {
      lastError = err;
      const pe = err instanceof ProviderError ? err : classifyProviderError(err, id);
      trail.push(`${id}:${pe.kind}`);
      console.error(`[registry] Provider ${id} failed (${pe.kind}); continuing down the chain.`);
    }
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new ProviderError(
    `Every provider in the chain [${chain.join(' → ')}] failed or was unconfigured.${detail}`,
    { kind: 'unknown', provider: 'registry', cause: lastError }
  );
}
