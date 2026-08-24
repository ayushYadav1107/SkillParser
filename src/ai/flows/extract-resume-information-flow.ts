/**
 * @fileOverview Extracting structured information from a candidate's resume.
 *
 * The extraction logic itself no longer lives here. It moved to
 * `src/lib/llm/`, which the evaluation harness also calls, and this flow is now a
 * thin adapter over it.
 *
 * That indirection is the point. When the app and the eval reach the model through
 * different code — different prompt text, different retry policy, different schema
 * handling — the eval measures something the product does not do, and the reported
 * accuracy silently stops applying to what users experience. One path means the
 * numbers on `/eval` describe this endpoint.
 *
 * The existing Gemini failover chain is preserved exactly (2.5-flash → 1.5-flash →
 * 1.5-pro with exponential backoff, inside `GeminiProvider`) and extended: when the
 * whole chain is exhausted the registry continues to Groq, and finally to the
 * offline rule-based parser, so an upload during a provider outage returns a
 * degraded extraction rather than an error page. `degraded` in the response tells
 * the UI to say which happened.
 */

import { z } from 'zod';

import { ai } from '@/ai/genkit';
import { kindFromFilename, mimeForKind } from '@/lib/llm/document';
import { humaniseProviderError } from '@/lib/llm/errors';
import { parseWithFailover } from '@/lib/llm/registry';
import { ParsedResumeSchema, type ParsedResume } from '@/lib/resume-schema';
import type { DocumentKind } from '@/lib/llm/types';

const ExtractResumeInformationInputSchema = z.object({
  resumeDataUri: z
    .string()
    .describe(
      "The resume document as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'. Supported MIME types are application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, and image/jpeg, image/png."
    ),
  /** Two worked examples in the prompt. Measured on `/eval`; see the report for the delta. */
  useFewShot: z.boolean().optional(),
});
export type ExtractResumeInformationInput = z.infer<typeof ExtractResumeInformationInputSchema>;

/**
 * The output schema is unchanged in its original four fields, so existing UI code
 * keeps working. `personal` and `confidence` are additive — see
 * `src/lib/resume-schema.ts` for why they exist.
 */
export const ExtractResumeInformationOutputSchema = ParsedResumeSchema;
export type ExtractResumeInformationOutput = ParsedResume;

/** Telemetry the UI can surface and the history table can store. */
export interface ExtractResumeInformationResult {
  data: ParsedResume;
  providerId: string;
  modelId: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  /** True when every LLM provider failed and the rule-based parser answered instead. */
  degraded: boolean;
  /** Providers and models tried and abandoned before the one that answered. */
  failoverTrail: string[];
}

export async function extractResumeInformationDetailed(
  input: ExtractResumeInformationInput
): Promise<ExtractResumeInformationResult> {
  const parsed = ExtractResumeInformationInputSchema.parse(input);
  const document = documentFromDataUri(parsed.resumeDataUri);

  try {
    const result = await parseWithFailover(document, {
      strategy: parsed.useFewShot ? 'few-shot' : 'zero-shot',
      requestConfidence: true,
    });

    return {
      data: result.parsed,
      providerId: result.providerId,
      modelId: result.modelId,
      latencyMs: result.latencyMs + result.preprocessing.latencyMs,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      degraded: result.degraded,
      failoverTrail: result.failoverTrail,
    };
  } catch (err) {
    // Surface something the user can act on rather than a provider stack trace.
    throw new Error(humaniseProviderError(err));
  }
}

/** Backwards-compatible entry point: returns just the extraction, as before. */
export async function extractResumeInformation(
  input: ExtractResumeInformationInput
): Promise<ExtractResumeInformationOutput> {
  return (await extractResumeInformationDetailed(input)).data;
}

/**
 * Still registered as a Genkit flow so it remains visible and runnable in the
 * Genkit developer UI (`npm run genkit:dev`) and keeps its tracing. The flow is a
 * wrapper now rather than the implementation — the model call happens inside the
 * provider, which is what lets the evaluation harness exercise the same path.
 */
export const extractResumeInformationFlow = ai.defineFlow(
  {
    name: 'extractResumeInformationFlow',
    inputSchema: ExtractResumeInformationInputSchema,
    outputSchema: ExtractResumeInformationOutputSchema,
  },
  async (input) => (await extractResumeInformationDetailed(input)).data
);

function documentFromDataUri(dataUri: string): {
  id: string;
  kind: DocumentKind;
  mimeType: string;
  bytes: Uint8Array;
} {
  const match = dataUri.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) {
    throw new Error('Expected a base64 data URI of the form data:<mimetype>;base64,<data>.');
  }
  const [, mimeType, base64] = match;
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.length === 0) throw new Error('The uploaded file is empty.');

  const kind: DocumentKind =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType.startsWith('image/')
        ? 'image'
        : mimeType.includes('wordprocessingml')
          ? 'docx'
          : kindFromFilename(mimeType);

  return {
    // Content-addressed so repeated uploads of the same file share a cache key
    // downstream without the caller having to invent an identifier.
    id: `upload-${bytes.length}-${bytes.slice(0, 32).join('')}`.slice(0, 64),
    kind,
    mimeType: mimeType || mimeForKind(kind),
    bytes,
  };
}
