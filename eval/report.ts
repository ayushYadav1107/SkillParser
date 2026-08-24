/**
 * @fileOverview Report rendering: a markdown report for the repository, and a
 * compact JSON summary for the public `/eval` page.
 *
 * Two rules shape what goes in:
 *
 * **Never print a bare point estimate.** Every F1 carries its bootstrap interval and
 * every A-vs-B delta carries a paired p-value. A table of naked three-decimal
 * numbers invites a reader to take a 0.004 difference seriously, and on sixty
 * documents that difference is noise.
 *
 * **Print the denominator.** Documents attempted, documents scored, documents that
 * failed, and why. An arm that skipped the scanned condition because OCR was
 * unavailable is not comparable to one that attempted it, and the report says so
 * next to the score rather than in a footnote nobody reads.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { compareArms, type ArmSummary } from './aggregate';
import type { PublicArm, PublicReport } from '../src/lib/eval/types';
import { paths } from './paths';
import { formatInterval, formatPValue } from './metrics/stats';
import type { RunArtifact } from './types';

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function renderMarkdownReport(run: RunArtifact, summaries: ArmSummary[]): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);

  p(`# SkillParser evaluation report`);
  p();
  p(`**Run** \`${run.metadata.runId}\` · ${run.metadata.documentCount} documents · corpus seed \`${run.metadata.corpusSeed}\` · harness v${run.metadata.harnessVersion}`);
  if (run.metadata.note) p(`\n> ${run.metadata.note}`);
  p();
  p(`Reproduce with:`);
  p('```bash');
  p('npm run eval:corpus     # regenerate the documents from the checked-in labels');
  p(`npm run eval -- --arms=${summaries.map((s) => s.spec.id).join(',')}`);
  p('```');
  p();
  p(`> The corpus is **synthetic**: structured records are generated first and rendered into`);
  p(`> documents, so every label is correct by construction and no real personal data is`);
  p(`> involved. Generated resumes are cleaner than real ones, so these scores are an`);
  p(`> **upper bound** on real-world accuracy. They are meant to be read comparatively —`);
  p(`> arm against arm under identical conditions — not as an absolute capability claim.`);
  p();

  // --- headline ----------------------------------------------------------
  p(`## Headline`);
  p();
  p(`| Arm | Micro-F1 (95% CI) | Macro-F1 | Scored | Failed | Skipped |`);
  p(`| --- | --- | --- | ---: | ---: | ---: |`);
  for (const s of summaries) {
    p(
      `| ${s.spec.label} | ${formatInterval(s.microF1Interval)} | ${s.macroF1.toFixed(3)} ` +
        `| ${s.documentsScored} | ${s.documentsFailed} | ${s.documentsSkipped} |`
    );
  }
  p();
  p(
    `Micro pools every field instance, so it is dominated by the numerous fields (skills). ` +
      `Macro averages the per-field F1s, giving \`email\` the same weight as \`skills\`. ` +
      `They answer different questions and both are reported.`
  );
  p();

  for (const s of summaries) {
    if (s.documentsFailed + s.documentsSkipped === 0) continue;
    const reasons = Object.entries(s.failureReasons)
      .map(([k, n]) => `${n}× ${k}`)
      .join(', ');
    p(`- **${s.spec.label}** did not score ${s.documentsFailed + s.documentsSkipped} document(s): ${reasons}. These contribute nothing to the metrics above.`);
  }
  p();

  // --- comparisons -------------------------------------------------------
  if (summaries.length > 1) {
    p(`## Arm comparisons`);
    p();
    p(
      `Paired bootstrap over documents (2000 resamples). Paired because both arms saw the ` +
        `same corpus, so per-document difficulty cancels and the test is far more sensitive ` +
        `than comparing two independent intervals. Overlapping CIs in the table above do ` +
        `**not** imply a non-significant difference.`
    );
    p();
    p(`| Baseline | Candidate | ΔMicro-F1 (95% CI) | Significance | Latency ×  | Cost × |`);
    p(`| --- | --- | --- | --- | ---: | ---: |`);
    const baseline = summaries[0];
    for (const candidate of summaries.slice(1)) {
      const c = compareArms(baseline, candidate);
      const sign = c.microF1.delta >= 0 ? '+' : '';
      p(
        `| ${baseline.spec.id} | ${candidate.spec.id} ` +
          `| ${sign}${c.microF1.delta.toFixed(3)} [${c.microF1.lower.toFixed(3)}, ${c.microF1.upper.toFixed(3)}] ` +
          `| ${formatPValue(c.microF1.pValue)}${c.microF1.pValue < 0.05 ? ' ✓' : ' (n.s.)'} ` +
          `| ${c.latencyRatio ? `${c.latencyRatio.toFixed(2)}×` : '—'} ` +
          `| ${c.costRatio ? `${c.costRatio.toFixed(2)}×` : '—'} |`
      );
      if (c.microF1.droppedDocuments > 0) {
        p(
          `| | | | ${c.microF1.droppedDocuments} document(s) scored by only one arm were excluded from this test. | | |`
        );
      }
    }
    p();
  }

  // --- per field ---------------------------------------------------------
  p(`## Per-field precision / recall / F1`);
  p();
  for (const s of summaries) {
    p(`### ${s.spec.label}`);
    p();
    p(`| Field | P | R | F1 | Support | Mean similarity |`);
    p(`| --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const f of s.perField) {
      if (f.counts.tp + f.counts.fp + f.counts.fn === 0) continue;
      p(
        `| \`${f.field}\` | ${f.precision.toFixed(3)} | ${f.recall.toFixed(3)} | ${f.f1.toFixed(3)} ` +
          `| ${f.support} | ${f.meanSimilarity == null ? '—' : f.meanSimilarity.toFixed(3)} |`
      );
    }
    p();
  }

  // --- conditions --------------------------------------------------------
  p(`## By condition (2×2 factorial: layout × modality)`);
  p();
  p(
    `Every record is rendered in all four cells, so layout and modality vary with the ` +
      `content held constant. A difference between cells is therefore attributable to the ` +
      `cell, not to a different pile of documents.`
  );
  p();
  p(`| Arm | ${summaries[0]?.byCondition.map((c) => c.label).join(' | ') ?? ''} |`);
  p(`| --- | ${(summaries[0]?.byCondition ?? []).map(() => '---:').join(' | ')} |`);
  for (const s of summaries) {
    p(`| ${s.spec.id} | ${s.byCondition.map((c) => `${c.micro.f1.toFixed(3)} (n=${c.documents})`).join(' | ')} |`);
  }
  p();

  // --- errors ------------------------------------------------------------
  p(`## Error analysis`);
  p();
  p(
    `Every failed field instance is assigned exactly one category, most-specific first. ` +
      `Two categories are informational and cost nothing in the F1 above: ` +
      `\`DATE_FORMAT_MISMATCH\` (right interval, different notation) and \`SCHEMA_REPAIR\` ` +
      `(the reply needed structural repair before it could be read).`
  );
  p();
  for (const s of summaries) {
    p(`### ${s.spec.label}`);
    p();
    if (s.errorCounts.length === 0) {
      p(`No errors recorded.`);
      p();
      continue;
    }
    p(`| Category | Count | Share of scored errors | What it means |`);
    p(`| --- | ---: | ---: | --- |`);
    for (const e of s.errorCounts) {
      p(
        `| \`${e.category}\`${e.informational ? ' *(info)*' : ''} | ${e.count} ` +
          `| ${e.informational ? '—' : `${(e.share * 100).toFixed(1)}%`} | ${e.description} |`
      );
    }
    p();
    p(
      `Prompts truncated to fit the token budget: **${s.truncatedPrompts}**. ` +
        `Replies needing schema repair: **${s.repairedReplies}**. ` +
        `Documents that fell through to a fallback model or provider: **${s.failedOver}**.`
    );
    p();
  }

  // --- calibration -------------------------------------------------------
  p(`## Confidence calibration`);
  p();
  p(
    `Two separate questions. **Discrimination** (AUROC): do higher-confidence extractions ` +
      `turn out right more often? **Calibration** (ECE): when the model says 0.8, is it ` +
      `right 80% of the time? A model can have one without the other, and which one it has ` +
      `decides whether the score is usable as a probability or only as a ranking.`
  );
  p();
  p(`| Arm | Scored | Unreported | Accuracy | Mean conf. | ECE ↓ | MCE ↓ | Brier ↓ | AUROC ↑ | Verdict |`);
  p(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
  for (const s of summaries) {
    const c = s.calibration;
    p(
      `| ${s.spec.id} | ${c.scored} | ${c.unreported} | ${c.accuracy.toFixed(3)} | ${c.meanConfidence.toFixed(3)} ` +
        `| ${c.ece.toFixed(3)} | ${c.mce.toFixed(3)} | ${c.brier.toFixed(3)} | ${c.auroc.toFixed(3)} ` +
        `| ${calibrationVerdict(c.ece, c.auroc, c.overconfident)} |`
    );
  }
  p();
  p(
    `\`Unreported\` counts predictions the provider returned no confidence for. They are ` +
      `excluded rather than imputed — substituting a default would manufacture the signal ` +
      `being measured. Misses are excluded too: a model cannot be uncertain about a field ` +
      `it never mentioned.`
  );
  p();

  for (const s of summaries) {
    if (s.calibration.scored === 0) continue;
    p(`### ${s.spec.label} — reliability`);
    p();
    p(`| Confidence bin | n | Mean conf. | Accuracy | Gap |`);
    p(`| --- | ---: | ---: | ---: | ---: |`);
    for (const b of s.calibration.bins) {
      if (b.count === 0) continue;
      p(
        `| ${b.lower.toFixed(1)}–${b.upper.toFixed(1)} | ${b.count} | ${b.meanConfidence.toFixed(3)} ` +
          `| ${b.accuracy.toFixed(3)} | ${b.gap >= 0 ? '+' : ''}${b.gap.toFixed(3)} |`
      );
    }
    p();
    p(`**Operating points** — auto-accept above a threshold, route the rest to human review:`);
    p();
    p(`| Threshold | Auto-accepted | Accuracy when accepted | Errors per 100 accepted | Share of errors caught |`);
    p(`| ---: | ---: | ---: | ---: | ---: |`);
    for (const r of s.routing) {
      p(
        `| ${r.threshold.toFixed(2)} | ${(r.autoAcceptRate * 100).toFixed(1)}% | ${r.autoAcceptAccuracy.toFixed(3)} ` +
          `| ${r.errorsPer100Accepted.toFixed(1)} | ${(r.errorsCaught * 100).toFixed(1)}% |`
      );
    }
    p();
  }

  // --- cost --------------------------------------------------------------
  p(`## Cost and latency`);
  p();
  p(`| Arm | Mean latency | p90 latency | Preproc. | Prompt tok. | Completion tok. | Cost / 1000 resumes |`);
  p(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of summaries) {
    const c = s.cost;
    p(
      `| ${s.spec.id} | ${Math.round(c.meanLatencyMs)} ms | ${Math.round(c.p90LatencyMs)} ms ` +
        `| ${Math.round(c.meanPreprocessingMs)} ms | ${Math.round(c.meanPromptTokens)} | ${Math.round(c.meanCompletionTokens)} ` +
        `| $${c.costPer1000ResumesUsd.toFixed(2)}${c.allTokensReported ? '' : ' *(est.)*'} |`
    );
  }
  p();
  p(
    `Preprocessing (PDF text extraction or OCR) is reported separately from model latency, ` +
      `because it belongs to the pipeline rather than the model — and for the text-only ` +
      `provider it is often the larger of the two. Costs marked *(est.)* were computed from ` +
      `a character-based token estimate because the provider did not report usage.`
  );
  p();

  p(`---`);
  p();
  p(`Generated by \`eval/report.ts\` (harness v${run.metadata.harnessVersion}) at ${run.metadata.finishedAt}.`);
  p();

  return out.join('\n');
}

function calibrationVerdict(ece: number, auroc: number, overconfident: boolean): string {
  const discrimination = auroc >= 0.75 ? 'ranks well' : auroc >= 0.6 ? 'ranks weakly' : 'no ranking signal';
  const calibration = ece <= 0.05 ? 'well calibrated' : ece <= 0.15 ? 'roughly calibrated' : 'poorly calibrated';
  const direction = overconfident ? 'overconfident' : 'underconfident';
  return `${discrimination}; ${calibration} (${direction})`;
}

// ---------------------------------------------------------------------------
// Public summary consumed by /eval
// ---------------------------------------------------------------------------

/** Writes the compact summary the `/eval` page imports. Types live in `src/lib/eval/types.ts`. */
export function writePublicSummary(run: RunArtifact, summaries: ArmSummary[]): PublicReport {
  const baseline = summaries[0];
  const report: PublicReport = {
    runId: run.metadata.runId,
    finishedAt: run.metadata.finishedAt,
    documentCount: run.metadata.documentCount,
    corpusSeed: run.metadata.corpusSeed,
    harnessVersion: run.metadata.harnessVersion,
    note: run.metadata.note,
    arms: summaries.map(toPublicArm),
    comparisons: summaries.slice(1).map((candidate) => {
      const c = compareArms(baseline, candidate);
      return {
        baselineId: c.baselineId,
        candidateId: c.candidateId,
        delta: c.microF1.delta,
        lower: c.microF1.lower,
        upper: c.microF1.upper,
        pValue: c.microF1.pValue,
        significant: c.microF1.pValue < 0.05,
        latencyRatio: c.latencyRatio,
        costRatio: c.costRatio,
        droppedDocuments: c.microF1.droppedDocuments,
      };
    }),
  };

  mkdirSync(dirname(paths.publicReportPath), { recursive: true });
  writeFileSync(paths.publicReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function toPublicArm(s: ArmSummary): PublicArm {
  return {
    id: s.spec.id,
    label: s.spec.label,
    provider: s.spec.provider,
    model: s.spec.model,
    strategy: s.spec.strategy,
    pdfStrategy: s.spec.pdfStrategy,
    microF1: s.micro.f1,
    microF1Lower: s.microF1Interval.lower,
    microF1Upper: s.microF1Interval.upper,
    macroF1: s.macroF1,
    precision: s.micro.precision,
    recall: s.micro.recall,
    documentsScored: s.documentsScored,
    documentsFailed: s.documentsFailed,
    documentsSkipped: s.documentsSkipped,
    failureReasons: s.failureReasons,
    perField: s.perField
      .filter((f) => f.counts.tp + f.counts.fp + f.counts.fn > 0)
      .map((f) => ({ field: f.field, precision: f.precision, recall: f.recall, f1: f.f1, support: f.support })),
    perGroup: s.perGroup.map((g) => ({
      group: g.group,
      precision: g.micro.precision,
      recall: g.micro.recall,
      f1: g.micro.f1,
    })),
    byCondition: s.byCondition.map((c) => ({ label: c.label, f1: c.micro.f1, documents: c.documents })),
    errorCounts: s.errorCounts,
    calibration: {
      scored: s.calibration.scored,
      unreported: s.calibration.unreported,
      ece: s.calibration.ece,
      mce: s.calibration.mce,
      brier: s.calibration.brier,
      auroc: s.calibration.auroc,
      accuracy: s.calibration.accuracy,
      meanConfidence: s.calibration.meanConfidence,
      overconfident: s.calibration.overconfident,
      bins: s.calibration.bins.map((b) => ({
        lower: b.lower,
        upper: b.upper,
        count: b.count,
        meanConfidence: b.meanConfidence,
        accuracy: b.accuracy,
      })),
    },
    routing: s.routing.map((r) => ({
      threshold: r.threshold,
      autoAcceptRate: r.autoAcceptRate,
      autoAcceptAccuracy: r.autoAcceptAccuracy,
      errorsCaught: r.errorsCaught,
    })),
    cost: {
      meanLatencyMs: s.cost.meanLatencyMs,
      p90LatencyMs: s.cost.p90LatencyMs,
      meanPreprocessingMs: s.cost.meanPreprocessingMs,
      meanPromptTokens: s.cost.meanPromptTokens,
      meanCompletionTokens: s.cost.meanCompletionTokens,
      costPer1000ResumesUsd: s.cost.costPer1000ResumesUsd,
      allTokensReported: s.cost.allTokensReported,
    },
    truncatedPrompts: s.truncatedPrompts,
    repairedReplies: s.repairedReplies,
    failedOver: s.failedOver,
  };
}
