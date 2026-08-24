/**
 * @fileOverview Character-budget prompt trimming for token-capped providers.
 *
 * Why characters and not a tokenizer
 * ----------------------------------
 * Running the real BPE tokenizer would be exact, but it costs a 1–2 MB vocabulary
 * download, adds a dependency to a hot path, and — crucially — you still have to
 * decide what to *drop* when the prompt is too long. The hard part is the trimming
 * policy, not the counting. A pessimistic character estimate gives an upper bound:
 * if the estimate says the prompt fits, it fits for real. `CHARS_PER_TOKEN = 3` is
 * deliberately below the ~4 chars/token of plain English because resume prompts
 * carry JSON schemas, few-shot examples and OCR output, all of which tokenize
 * denser than prose. Raising it to 4 makes the estimate optimistic and the guard
 * stops guarding.
 *
 * The one constraint everything else follows from
 * ----------------------------------------------
 * Groq screens a request as `prompt_tokens + max_tokens` against the per-minute
 * ceiling. The reply reservation and the prompt budget are two halves of one
 * number: asking for a longer reply *takes context away* from the same call. So the
 * budget is always computed against a specific reply reservation, never in the
 * abstract.
 */

/** Pessimistic on purpose. See the file header before changing this. */
export const CHARS_PER_TOKEN = 3;

/** Fraction of the nominal TPM ceiling we are willing to aim at. */
export const DEFAULT_TPM_UTILISATION = 0.9;

/** Extra headroom on top of utilisation, for the parts of the payload we do not model. */
export const DEFAULT_SAFETY_MARGIN = 0.85;

export interface BudgetInput {
  /** Provider tokens-per-minute ceiling for the target model. */
  tpmLimit: number;
  /** Tokens reserved for the reply (`max_tokens` on the request). */
  replyTokens: number;
  /** Tokens consumed by fixed scaffolding we cannot trim (system prompt, schema). */
  fixedOverheadTokens?: number;
  utilisation?: number;
  safetyMargin?: number;
}

export interface BudgetResult {
  /** Characters available for the trimmable portion of the prompt. */
  charBudget: number;
  /** The same figure expressed in the pessimistic token estimate. */
  tokenBudget: number;
  /** What the whole request is projected to cost, for logging. */
  projectedRequestTokens: number;
}

/**
 * How many characters of trimmable prompt fit alongside the reply reservation.
 * Returns a `charBudget` of 0 rather than a negative number when the reservation
 * alone already exceeds the ceiling — callers should treat that as oversized.
 */
export function promptCharBudget(input: BudgetInput): BudgetResult {
  const utilisation = input.utilisation ?? DEFAULT_TPM_UTILISATION;
  const safety = input.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const overhead = input.fixedOverheadTokens ?? 0;

  const usable = input.tpmLimit * utilisation - input.replyTokens - overhead;
  const tokenBudget = Math.max(0, Math.floor(usable * safety));
  return {
    charBudget: tokenBudget * CHARS_PER_TOKEN,
    tokenBudget,
    projectedRequestTokens: Math.ceil(input.replyTokens + overhead + tokenBudget),
  };
}

/** Upper-bound token count for a string. Never underestimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface PromptSection {
  label: string;
  value: string | null | undefined;
  /**
   * Relative importance. A section with weight 10 gets ten times the initial
   * allowance of a section with weight 1. Weights set the *starting* share only;
   * see `fitSections` for what happens to the leftovers.
   */
  weight: number;
}

export interface FittedSection {
  label: string;
  value: string;
  originalChars: number;
  keptChars: number;
  truncated: boolean;
}

export interface FitResult {
  sections: FittedSection[];
  totalChars: number;
  budgetChars: number;
  /** True if anything at all had to be cut. Worth logging — it means data was lost. */
  anyTruncated: boolean;
}

/**
 * Distributes `budget` characters across weighted sections.
 *
 * Two properties matter and neither is obvious from a naive weighted split:
 *
 *  1. **Redistribution.** A section shorter than its share does not need its share.
 *     The unused remainder is handed back to the sections that are over theirs, in
 *     proportion to their weights, and this repeats until nothing more can be
 *     given away. Without this, a prompt with one long section and five short ones
 *     truncates the long one while leaving most of the budget unspent.
 *
 *  2. **`null` normalisation.** `String(null)` is the four-character string
 *     `"null"`, which renders into the prompt as literal text and quietly teaches
 *     the model that missing values look like that. Absent sections become `''`
 *     and are dropped.
 */
export function fitSections(sections: PromptSection[], budget: number): FitResult {
  const normalised = sections.map((s) => ({
    label: s.label,
    value: s.value == null ? '' : String(s.value),
    weight: Math.max(0, s.weight),
  }));

  const totalOriginal = normalised.reduce((a, s) => a + s.value.length, 0);

  // Everything fits — no work to do, and importantly no truncation flags raised.
  if (totalOriginal <= budget) {
    return {
      sections: normalised.map((s) => ({
        label: s.label,
        value: s.value,
        originalChars: s.value.length,
        keptChars: s.value.length,
        truncated: false,
      })),
      totalChars: totalOriginal,
      budgetChars: budget,
      anyTruncated: false,
    };
  }

  const allowance = new Map<string, number>();
  let remaining = budget;
  let contenders = normalised.filter((s) => s.weight > 0 && s.value.length > 0);

  // Zero-weight sections are dropped entirely when we are over budget.
  for (const s of normalised) {
    if (s.weight <= 0 || s.value.length === 0) allowance.set(s.label, 0);
  }

  // Iteratively hand out the budget, reclaiming whatever short sections leave behind.
  while (contenders.length > 0 && remaining > 0) {
    const weightSum = contenders.reduce((a, s) => a + s.weight, 0);
    if (weightSum <= 0) break;

    const satisfied: typeof contenders = [];
    let handedOut = 0;

    for (const s of contenders) {
      const share = Math.floor((remaining * s.weight) / weightSum);
      if (s.value.length <= share) {
        // Section fits inside its share; it is done and frees the difference.
        allowance.set(s.label, s.value.length);
        handedOut += s.value.length;
        satisfied.push(s);
      }
    }

    if (satisfied.length === 0) {
      // Nobody fits: every remaining section is genuinely over its share, so the
      // proportional split is final.
      for (const s of contenders) {
        allowance.set(s.label, Math.floor((remaining * s.weight) / weightSum));
      }
      remaining = 0;
      contenders = [];
      break;
    }

    remaining -= handedOut;
    contenders = contenders.filter((s) => !satisfied.includes(s));
  }

  // Anything still unallocated after the loop gets nothing.
  for (const s of normalised) if (!allowance.has(s.label)) allowance.set(s.label, 0);

  const fitted = normalised.map((s) => {
    const keep = allowance.get(s.label) ?? 0;
    const truncated = keep < s.value.length;
    const value = truncated ? truncateAtBoundary(s.value, keep) : s.value;
    return {
      label: s.label,
      value,
      originalChars: s.value.length,
      keptChars: value.length,
      truncated,
    };
  });

  return {
    sections: fitted,
    totalChars: fitted.reduce((a, s) => a + s.value.length, 0),
    budgetChars: budget,
    anyTruncated: fitted.some((s) => s.truncated),
  };
}

const TRUNCATION_MARKER = '\n[…truncated to fit the token budget…]';

/**
 * Cuts at the last newline or space before the limit so a trimmed section does not
 * end mid-word — a half-word at the boundary reads to the model as a typo and shows
 * up in the error analysis as a spurious extraction failure.
 *
 * The marker counts against `limit`. It has to: the whole point of the budget is
 * that the returned string is never longer than what was allocated, and a marker
 * appended *after* the cut silently reintroduces the overflow the budget exists to
 * prevent. When the limit is too small to hold a marker plus anything useful, the
 * section is dropped entirely instead.
 */
export function truncateAtBoundary(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const room = limit - TRUNCATION_MARKER.length;
  if (room < 24) return '';
  const slice = text.slice(0, room);
  const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
  const body = cut > room * 0.6 ? slice.slice(0, cut) : slice;
  return `${body.trimEnd()}${TRUNCATION_MARKER}`;
}

/** Renders fitted sections into the final prompt body. */
export function renderSections(sections: FittedSection[]): string {
  return sections
    .filter((s) => s.value.trim().length > 0)
    .map((s) => `### ${s.label}\n${s.value}`)
    .join('\n\n');
}
