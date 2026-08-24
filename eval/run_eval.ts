/**
 * @fileOverview The evaluation harness. `npm run eval`.
 *
 * Runs one or more arms over the ground-truth corpus, scores every extraction,
 * writes an append-only run artifact, and regenerates the markdown report and the
 * summary the public `/eval` page reads.
 *
 * Three properties are worth calling out because they are what make the numbers
 * trustworthy rather than merely produced:
 *
 * **Failures are recorded, not swallowed.** A document the provider could not
 * process is `status: 'error'` or `'skipped'`, never a zero-scored extraction.
 * Scoring a failed call as "got nothing right" silently mixes reliability into
 * accuracy: an arm that crashes on 20% of the corpus would look like a mediocre
 * extractor rather than a broken one, and the fix for those two problems is not the
 * same. The report prints both numbers side by side.
 *
 * **Every response is cached.** Keyed by arm, document, and a hash of the exact
 * prompt configuration, so re-running after a change to the *metrics* costs
 * nothing. This matters more than it sounds: the analysis is iterated on far more
 * often than the model calls are, and a harness that re-bills every experiment
 * discourages exactly the iteration that makes the analysis good. Changing the
 * prompt changes the hash and correctly invalidates the cache.
 *
 * **Concurrency is bounded and low by default.** Free-tier providers throttle per
 * minute, and a fast harness that trips rate limits produces a run full of retry
 * latency that is then reported as model latency.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { CONDITIONS, type Condition, type Manifest } from './corpus/generate';
import type { ResumeRecord } from './corpus/records';
import { resolveArms, DEFAULT_ARMS } from './arms';
import { paths } from './paths';
import { summariseRun } from './aggregate';
import { renderMarkdownReport, writePublicSummary } from './report';
import { emptyErrorCounts, type ErrorCategory } from './metrics/errors';
import { scoreDocument, type FieldObservation } from './metrics/score';
import { HARNESS_VERSION, type ArmSpec, type DocumentResult, type RunArtifact } from './types';

import { kindFromFilename, mimeForKind } from '../src/lib/llm/document';
import { CapabilityUnavailableError, ProviderError, classifyProviderError } from '../src/lib/llm/errors';
import { getProvider, type ProviderId } from '../src/lib/llm/registry';
import { estimatedCostUsd, type LLMProvider, type ProviderResult, type ResumeDocument } from '../src/lib/llm/types';
import { coerceParsedResume } from '../src/lib/resume-schema';

interface CliOptions {
  arms: string[];
  conditions: Condition[];
  limit: number | null;
  concurrency: number;
  useCache: boolean;
  note?: string;
  /** Use the balanced one-condition-per-record split instead of the full factorial. */
  primaryOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const conditionArg = get('condition') ?? 'primary';
  const conditions: Condition[] =
    conditionArg === 'all' || conditionArg === 'primary'
      ? CONDITIONS
      : (conditionArg.split(',').filter((c) => (CONDITIONS as string[]).includes(c)) as Condition[]);

  return {
    arms: (get('arms') ?? DEFAULT_ARMS.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
    conditions: conditions.length ? conditions : CONDITIONS,
    limit: get('limit') ? Number.parseInt(get('limit')!, 10) : null,
    concurrency: get('concurrency') ? Math.max(1, Number.parseInt(get('concurrency')!, 10)) : 2,
    useCache: !has('no-cache'),
    note: get('note'),
    primaryOnly: conditionArg === 'primary',
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(paths.manifestPath)) {
    console.error(
      'No corpus found. Run `npm run eval:corpus` first — it regenerates the documents from the checked-in labels.'
    );
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(readFileSync(paths.manifestPath, 'utf8'));
  const records = new Map<string, ResumeRecord>();
  for (const file of new Set(manifest.documents.map((d) => `${d.recordId}.json`))) {
    const record: ResumeRecord = JSON.parse(readFileSync(join(paths.recordsDir, file), 'utf8'));
    records.set(record.id, record);
  }

  const primary = new Set(manifest.primarySplit);
  let documents = manifest.documents.filter((d) => options.conditions.includes(d.condition));
  if (options.primaryOnly) documents = documents.filter((d) => primary.has(d.id));
  if (options.limit) documents = documents.slice(0, options.limit);

  if (documents.length === 0) {
    console.error('No documents selected. Check --condition / --limit.');
    process.exit(1);
  }

  const requested = resolveArms(options.arms);
  const arms: ArmSpec[] = [];
  for (const spec of requested) {
    const provider = await getProvider(spec.provider as ProviderId);
    if (provider.isConfigured()) {
      arms.push(spec);
    } else {
      console.warn(
        `[eval] Skipping arm "${spec.id}": ${spec.provider} is not configured (missing API key). ` +
          `The run continues with the remaining arms.`
      );
    }
  }

  if (arms.length === 0) {
    console.error(
      'No configured arms.\n' +
        '  Set GROQ_API_KEY in .env (https://console.groq.com/keys), then run\n' +
        '  `npm run groq:check` to confirm the key can reach the configured models.\n' +
        '  Or run the offline arms: `npm run eval -- --arms=heuristic,heuristic-naive-pdf`'
    );
    process.exit(1);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const startedAt = new Date().toISOString();
  console.log(
    `[eval] run ${runId}: ${arms.length} arm(s) × ${documents.length} document(s), concurrency ${options.concurrency}`
  );

  const armResults: RunArtifact['arms'] = [];

  for (const spec of arms) {
    console.log(`\n[eval] === arm ${spec.id} (${spec.label}) ===`);
    const provider = await getProvider(spec.provider as ProviderId);
    const results = await runArm(spec, provider, documents, records, options);
    const ok = results.filter((r) => r.status === 'ok').length;
    console.log(`[eval] ${spec.id}: ${ok}/${results.length} scored`);
    armResults.push({ spec, documents: results });
  }

  const artifact: RunArtifact = {
    metadata: {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      corpusSeed: manifest.seed,
      corpusGeneratorVersion: manifest.generatorVersion,
      harnessVersion: HARNESS_VERSION,
      conditions: options.conditions,
      documentCount: documents.length,
      note: options.note,
    },
    arms: armResults,
  };

  mkdirSync(paths.runsDir, { recursive: true });
  mkdirSync(paths.historyDir, { recursive: true });
  mkdirSync(paths.reportsDir, { recursive: true });

  // The full artifact carries every field observation — a few megabytes per run,
  // which is the right thing to keep on disk for debugging and the wrong thing to
  // accumulate in git. It stays local (gitignored).
  const runPath = join(paths.runsDir, `${runId}.json`);
  writeFileSync(runPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const summaries = summariseRun(artifact);

  // The aggregated summary is checked in. It keeps per-document pooled counts, so a
  // future run can be compared against this one with the same paired test without
  // re-calling any model — which is what makes the eval a history rather than a
  // snapshot.
  writeFileSync(
    join(paths.historyDir, `${runId}.summary.json`),
    `${JSON.stringify({ metadata: artifact.metadata, summaries }, null, 2)}\n`,
    'utf8'
  );
  const markdown = renderMarkdownReport(artifact, summaries);
  const reportPath = join(paths.reportsDir, `${runId}.md`);
  writeFileSync(reportPath, markdown, 'utf8');
  writeFileSync(join(paths.reportsDir, 'latest.md'), markdown, 'utf8');
  writePublicSummary(artifact, summaries);

  console.log(`\n[eval] run     → ${runPath} (full, gitignored)`);
  console.log(`[eval] history → ${join(paths.historyDir, `${runId}.summary.json`)}`);
  console.log(`[eval] report  → ${reportPath}`);
  console.log(`[eval] page    → ${paths.publicReportPath} (rendered at /eval)`);
  console.log(`\n${headline(summaries)}`);
}

function headline(summaries: ReturnType<typeof summariseRun>): string {
  return summaries
    .map(
      (s) =>
        `  ${s.spec.id.padEnd(22)} micro-F1 ${s.micro.f1.toFixed(3)} ` +
        `[${s.microF1Interval.lower.toFixed(3)}, ${s.microF1Interval.upper.toFixed(3)}]  ` +
        `macro-F1 ${s.macroF1.toFixed(3)}  ` +
        `scored ${s.documentsScored}/${s.documentsAttempted}`
    )
    .join('\n');
}

// ---------------------------------------------------------------------------

async function runArm(
  spec: ArmSpec,
  provider: LLMProvider,
  documents: Manifest['documents'],
  records: Map<string, ResumeRecord>,
  options: CliOptions
): Promise<DocumentResult[]> {
  const results: DocumentResult[] = new Array(documents.length);
  let completed = 0;
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= documents.length) return;

      const manifestDoc = documents[index];
      const record = records.get(manifestDoc.recordId);
      if (!record) throw new Error(`No ground-truth record for ${manifestDoc.recordId}`);

      results[index] = await evaluateDocument(spec, provider, manifestDoc, record, options);
      completed += 1;
      if (completed % 10 === 0 || completed === documents.length) {
        process.stdout.write(`\r[eval]   ${completed}/${documents.length}`);
        if (completed === documents.length) process.stdout.write('\n');
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency, documents.length) }, worker));
  return results;
}

async function evaluateDocument(
  spec: ArmSpec,
  provider: LLMProvider,
  manifestDoc: Manifest['documents'][number],
  record: ResumeRecord,
  options: CliOptions
): Promise<DocumentResult> {
  const base = {
    documentId: manifestDoc.id,
    recordId: manifestDoc.recordId,
    condition: manifestDoc.condition,
    layout: manifestDoc.layout,
    modality: manifestDoc.modality,
  } as const;

  const filePath = join(paths.documentsDir, manifestDoc.file);
  if (!existsSync(filePath)) {
    return failure(base, 'missing-document', `Rendered document not found: ${manifestDoc.file}. Run \`npm run eval:corpus\`.`, 'skipped');
  }

  const bytes = new Uint8Array(readFileSync(filePath));
  const document: ResumeDocument = {
    id: manifestDoc.id,
    kind: kindFromFilename(manifestDoc.file),
    mimeType: mimeForKind(kindFromFilename(manifestDoc.file), manifestDoc.file),
    bytes,
    filename: manifestDoc.file,
  };

  let result: ProviderResult;
  try {
    result = await callWithCache(spec, provider, document, options);
  } catch (err) {
    if (err instanceof CapabilityUnavailableError) {
      return failure(base, 'ocr-unavailable', err.message, 'skipped');
    }
    const pe = err instanceof ProviderError ? err : classifyProviderError(err, spec.provider);
    return failure(base, pe.kind, pe.message, 'error');
  }

  const scored = scoreDocument(manifestDoc.id, manifestDoc.recordId, record.truth, result.parsed, {
    scanned: manifestDoc.modality === 'scanned',
  });

  // A failover chain can serve a request from a different model than the arm
  // configured, and models are priced differently. Cost the model that actually
  // answered, not the one we asked for.
  const pricing = spec.provider.startsWith('groq')
    ? (await import('../src/lib/llm/providers/groq')).groqPricingFor(result.modelId)
    : spec.provider === 'gemini'
      ? (await import('../src/lib/llm/providers/gemini')).geminiPricingFor(result.modelId)
      : provider.pricing;

  return {
    ...base,
    status: 'ok',
    latencyMs: result.latencyMs,
    preprocessingMs: result.preprocessing.latencyMs,
    preprocessingPath: result.preprocessing.path,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    tokensReported: result.usage.reported,
    costUsd: estimatedCostUsd(result.usage, pricing),
    servingModel: result.modelId,
    failoverTrail: result.failoverTrail,
    repairs: result.repairs,
    promptTruncated: result.preprocessing.truncated,
    counts: scored.perField,
    observations: scored.observations,
    errorCategories: tallyErrors(scored.observations, result.repairs.length > 0),
  };
}

function failure(
  base: Pick<DocumentResult, 'documentId' | 'recordId' | 'condition' | 'layout' | 'modality'>,
  kind: string,
  message: string,
  status: 'error' | 'skipped'
): DocumentResult {
  const categories = emptyErrorCounts();
  categories[status === 'skipped' && kind === 'ocr-unavailable' ? 'OCR_UNAVAILABLE' : 'PROVIDER_ERROR'] = 1;
  return {
    ...base,
    status,
    errorKind: kind,
    errorMessage: message.slice(0, 500),
    latencyMs: 0,
    preprocessingMs: 0,
    preprocessingPath: 'none',
    promptTokens: 0,
    completionTokens: 0,
    tokensReported: true,
    costUsd: 0,
    servingModel: '',
    failoverTrail: [],
    repairs: [],
    promptTruncated: false,
    // No counts at all: a failed call contributes nothing to precision or recall.
    // See the file header for why it must not contribute zeros instead.
    counts: {} as DocumentResult['counts'],
    observations: [],
    errorCategories: categories,
  };
}

function tallyErrors(
  observations: FieldObservation[],
  repaired: boolean
): Partial<Record<ErrorCategory, number>> {
  const counts: Partial<Record<ErrorCategory, number>> = {};
  for (const o of observations) {
    if (!o.errorCategory) continue;
    counts[o.errorCategory] = (counts[o.errorCategory] ?? 0) + 1;
  }
  if (repaired) counts.SCHEMA_REPAIR = (counts.SCHEMA_REPAIR ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Response cache
// ---------------------------------------------------------------------------

/**
 * The cache key covers everything that could change the reply: the provider, the
 * model, the prompt strategy, the preprocessing strategy, the confidence request,
 * and the document's own checksum. Anything left out of this hash is a way to
 * silently serve a stale response after a change that should have invalidated it —
 * which would be the single worst bug this harness could have, because the numbers
 * would still look plausible.
 */
function cacheKey(spec: ArmSpec, document: ResumeDocument): string {
  const digest = createHash('sha256')
    .update(spec.provider)
    .update(' ')
    .update(spec.model)
    .update(' ')
    .update(spec.strategy)
    .update(' ')
    .update(spec.pdfStrategy)
    .update(' ')
    .update(String(spec.requestConfidence))
    .update(' ')
    .update(Buffer.from(document.bytes))
    .digest('hex');
  return digest.slice(0, 32);
}

async function callWithCache(
  spec: ArmSpec,
  provider: LLMProvider,
  document: ResumeDocument,
  options: CliOptions
): Promise<ProviderResult> {
  const dir = join(paths.cacheDir, spec.id);
  const file = join(dir, `${document.id}.${cacheKey(spec, document)}.json`);

  if (options.useCache && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as ProviderResult;
    // Re-coerce rather than trusting the stored object: the schema may have gained a
    // field since the response was cached, and the cache holds raw model output.
    return { ...cached, parsed: coerceParsedResume(cached.parsed).value };
  }

  const result = await provider.parse(document, {
    strategy: spec.strategy,
    // The arm names the text model explicitly. Providers that route images to a
    // separate vision model ignore this for those documents and say so.
    model: spec.model,
    requestConfidence: spec.requestConfidence,
    pdfStrategy: spec.pdfStrategy,
  });

  if (options.useCache) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return result;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('eval/run_eval.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main as runEval };
