import { describe, it, assert, assertEqual } from './harness';
import {
  PromptTooLargeError,
  classifyProviderError,
  humaniseProviderError,
  parseRetryAfterSeconds,
  parseTokenCounts,
} from '../../src/lib/llm/errors';

describe('provider error classification', () => {
  it('classifies a real Groq 413 as oversized, not as a rate limit', () => {
    // The verbatim wording. It contains "tokens per minute", so a rate-limit rule
    // evaluated first matches it — and then the caller retries with backoff a
    // request that can never succeed, burning the whole retry budget first.
    const message =
      'Error code: 413 - Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 11269';
    const err = classifyProviderError(new Error(message), 'groq');
    assertEqual(err.kind, 'oversized');
    assertEqual(err.retryable, false);
    assert(err instanceof PromptTooLargeError, 'should be a PromptTooLargeError');
    assertEqual((err as PromptTooLargeError).limitTokens, 8000);
    assertEqual((err as PromptTooLargeError).requestedTokens, 11269);
  });

  it('classifies a 413 by status even when the body says nothing useful', () => {
    const err = classifyProviderError(new Error('Payload too big'), 'groq', 413);
    assertEqual(err.kind, 'oversized');
    assertEqual(err.retryable, false);
  });

  it('classifies an ordinary 429 as retryable and reads the wait hint', () => {
    const err = classifyProviderError(
      new Error('Rate limit reached for model. Please try again in 7.5s.'),
      'groq',
      429
    );
    assertEqual(err.kind, 'rate_limit');
    assertEqual(err.retryable, true);
    assertEqual(err.retryAfterSeconds, 7.5);
  });

  it('never sleeps longer than about a minute on a provider hint', () => {
    assertEqual(parseRetryAfterSeconds('try again in 40m'), 65);
  });

  it('treats bad credentials as terminal', () => {
    const err = classifyProviderError(new Error('Invalid API Key'), 'gemini');
    assertEqual(err.kind, 'auth');
    assertEqual(err.retryable, false);
  });

  it('treats 5xx and socket failures as transient', () => {
    assertEqual(classifyProviderError(new Error('fetch failed'), 'groq').kind, 'transient');
    assertEqual(classifyProviderError(new Error('boom'), 'groq', 503).kind, 'transient');
  });

  it('parses limit and requested counts with thousands separators', () => {
    assertEqual(parseTokenCounts('Limit 8,000, Requested 11,269'), { limit: 8000, requested: 11269 });
  });

  it('names the actionable fix in the oversized message', () => {
    const text = humaniseProviderError(
      classifyProviderError(new Error('Request too large'), 'groq', 413)
    );
    assert(text.includes('Retrying will not help'), `unhelpful message: ${text}`);
    assert(text.includes('RESUME_PROMPT_RESERVE_TOKENS') || text.includes('provider'), text);
  });
});
