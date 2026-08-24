/**
 * @fileOverview Error taxonomy for LLM calls.
 *
 * The important distinction here is between a request that is *too big* and a
 * request that arrived *too fast*. Both surface from Groq as an HTTP error
 * mentioning tokens-per-minute, and both are easy to lump together as "rate
 * limited" — but waiting cannot shrink a request. A 413 retried with backoff burns
 * the retry budget and then fails anyway, which is exactly the bug this module
 * exists to prevent. `classifyProviderError` therefore checks the oversized markers
 * *before* the retryable ones; the order is load-bearing, not incidental.
 */

export type ErrorKind =
  | 'oversized' // Request exceeds the model's per-request or per-minute ceiling. Never retry.
  | 'rate_limit' // Transient throttling. Retry with backoff, honouring any hint.
  | 'auth' // Bad or missing credentials. Never retry.
  | 'transient' // 5xx, socket hang-up, timeout. Retry with backoff.
  | 'schema' // The model replied, but not in the requested shape.
  | 'unavailable' // A required local capability is missing (e.g. no OCR engine).
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  /** Seconds the provider asked us to wait, when it said so explicitly. */
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    opts: { kind: ErrorKind; provider: string; retryAfterSeconds?: number; cause?: unknown }
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.cause = opts.cause;
    this.retryable = opts.kind === 'rate_limit' || opts.kind === 'transient';
  }
}

/** Raised when prompt + reply reservation cannot fit under the ceiling. Not retryable. */
export class PromptTooLargeError extends ProviderError {
  readonly requestedTokens?: number;
  readonly limitTokens?: number;

  constructor(
    message: string,
    opts: { provider: string; requestedTokens?: number; limitTokens?: number; cause?: unknown }
  ) {
    super(message, { kind: 'oversized', provider: opts.provider, cause: opts.cause });
    this.name = 'PromptTooLargeError';
    this.requestedTokens = opts.requestedTokens;
    this.limitTokens = opts.limitTokens;
  }
}

/** Raised when a text-only provider is handed a scan and no OCR engine is installed. */
export class CapabilityUnavailableError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, { kind: 'unavailable', provider });
    this.name = 'CapabilityUnavailableError';
  }
}

/**
 * Checked FIRST. An oversized request is permanently oversized.
 * Groq's own wording is `Request too large for model ... on tokens per minute (TPM)`,
 * which contains "tokens per minute" and would otherwise match a rate-limit rule.
 */
const OVERSIZED_MARKERS = [
  'request too large',
  'reduce the length of the messages',
  'context_length_exceeded',
  'maximum context length',
  'string too long',
  'prompt is too long',
  'input is too long',
];

const RATE_LIMIT_MARKERS = [
  'rate limit',
  'rate_limit_exceeded',
  'too many requests',
  'quota exceeded',
  'resource_exhausted',
  'requests per minute',
  'tokens per minute',
  '429',
];

const AUTH_MARKERS = [
  'invalid api key',
  'invalid_api_key',
  'unauthorized',
  'authentication',
  'permission denied',
  'api key not valid',
  '401',
  '403',
];

const TRANSIENT_MARKERS = [
  'internal server error',
  'service unavailable',
  'bad gateway',
  'overloaded',
  'econnreset',
  'etimedout',
  'socket hang up',
  'fetch failed',
  'network',
  'timeout',
  '500',
  '502',
  '503',
  '504',
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Pulls "try again in 7.5s" / "retry-after: 12" out of a provider message. */
export function parseRetryAfterSeconds(message: string): number | undefined {
  const patterns = [
    /try again in\s+([\d.]+)\s*s/i,
    /retry[- ]after[:\s]+([\d.]+)/i,
    /please retry after\s+([\d.]+)\s*second/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 0) return Math.min(n, 65); // never sleep longer than a minute-ish
    }
  }
  const minutes = message.match(/try again in\s+([\d.]+)\s*m/i);
  if (minutes) {
    const n = Number.parseFloat(minutes[1]);
    if (Number.isFinite(n)) return Math.min(n * 60, 65);
  }
  return undefined;
}

/** Extracts `Limit 8000, Requested 11269` style numbers when the provider reports them. */
export function parseTokenCounts(message: string): { limit?: number; requested?: number } {
  const limit = message.match(/limit\s+(\d[\d,]*)/i);
  const requested = message.match(/requested\s+(\d[\d,]*)/i);
  const num = (s?: string) => (s ? Number.parseInt(s.replace(/,/g, ''), 10) : undefined);
  return { limit: num(limit?.[1]), requested: num(requested?.[1]) };
}

/**
 * Maps an arbitrary thrown value onto the taxonomy above.
 * `status` is passed separately when the caller has an HTTP status in hand, because
 * a 413 body does not always contain the phrase "request too large".
 */
export function classifyProviderError(
  err: unknown,
  provider: string,
  status?: number
): ProviderError {
  if (err instanceof ProviderError) return err;

  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();

  if (status === 413 || includesAny(text, OVERSIZED_MARKERS)) {
    const { limit, requested } = parseTokenCounts(raw);
    return new PromptTooLargeError(raw, {
      provider,
      limitTokens: limit,
      requestedTokens: requested,
      cause: err,
    });
  }
  if (status === 401 || status === 403 || includesAny(text, AUTH_MARKERS)) {
    return new ProviderError(raw, { kind: 'auth', provider, cause: err });
  }
  if (status === 429 || includesAny(text, RATE_LIMIT_MARKERS)) {
    return new ProviderError(raw, {
      kind: 'rate_limit',
      provider,
      retryAfterSeconds: parseRetryAfterSeconds(raw),
      cause: err,
    });
  }
  if ((status && status >= 500) || includesAny(text, TRANSIENT_MARKERS)) {
    return new ProviderError(raw, { kind: 'transient', provider, cause: err });
  }
  return new ProviderError(raw, { kind: 'unknown', provider, cause: err });
}

/**
 * Turns a provider error into something a user can act on. The UI shows this
 * verbatim, so it names the environment variable or the wait rather than echoing a
 * provider stack trace.
 */
export function humaniseProviderError(err: unknown): string {
  const pe = err instanceof ProviderError ? err : classifyProviderError(err, 'unknown');
  switch (pe.kind) {
    case 'oversized': {
      const p = pe as PromptTooLargeError;
      const nums =
        p.requestedTokens && p.limitTokens
          ? ` (needed ~${p.requestedTokens} tokens against a ${p.limitTokens} ceiling)`
          : '';
      return `This document is too large for ${pe.provider} in a single request${nums}. Retrying will not help — lower RESUME_PROMPT_RESERVE_TOKENS, or use a provider with a larger per-minute allowance.`;
    }
    case 'rate_limit':
      return pe.retryAfterSeconds
        ? `${pe.provider} is rate limiting this key. It asked us to wait ${Math.ceil(pe.retryAfterSeconds)}s.`
        : `${pe.provider} is rate limiting this key. Wait a minute and try again.`;
    case 'auth':
      return `${pe.provider} rejected the credentials. Check the API key in your .env file.`;
    case 'unavailable':
      return pe.message;
    case 'schema':
      return `${pe.provider} replied, but not in the expected JSON shape. ${truncate(pe.message, 200)}`;
    case 'transient':
      return `${pe.provider} had a temporary failure. ${truncate(pe.message, 200)}`;
    default:
      return truncate(pe.message, 400);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
