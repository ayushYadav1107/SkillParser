/**
 * @fileOverview Presentation for the public evaluation report.
 *
 * A server component with no client-side JavaScript. The page is a set of tables
 * and one SVG diagram over a JSON file that was written at build time; shipping a
 * charting library to render it would add more bytes than the data it displays.
 *
 * The editorial rule matches the markdown report: no number appears without its
 * denominator or its interval. A reviewer arriving at this URL from a résumé link
 * should be able to work out, without cloning anything, what was measured, on how
 * many documents, against what baseline, and how confident the claim is.
 */

import type { PublicArm, PublicReport } from '@/lib/eval/types';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const f3 = (n: number) => n.toFixed(3);

export function ReportView({ report }: { report: PublicReport }) {
  const baseline = report.arms[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12 md:px-8">
      <Header report={report} />
      <SyntheticCaveat />
      <Headline arms={report.arms} />
      {report.comparisons.length > 0 && (
        <Comparisons report={report} baselineLabel={baseline?.label ?? ''} />
      )}
      <Conditions arms={report.arms} />
      <PerField arms={report.arms} />
      <Errors arms={report.arms} />
      <Calibration arms={report.arms} />
      <CostLatency arms={report.arms} />
      <Method report={report} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{lead}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {head}
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

const th = 'px-3 py-2 text-left font-medium whitespace-nowrap';
const thr = 'px-3 py-2 text-right font-medium whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const tdr = 'px-3 py-2 text-right align-top tabular-nums whitespace-nowrap';

// ---------------------------------------------------------------------------

function Header({ report }: { report: PublicReport }) {
  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        SkillParser
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
        Resume extraction: evaluation report
      </h1>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Field-level precision, recall and F1 for every extraction arm, measured against a labelled
        corpus, with bootstrap confidence intervals, an error taxonomy, a confidence-calibration
        analysis, and the cost each point of accuracy was bought at.
      </p>
      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <Meta label="Run" value={report.runId} />
        <Meta label="Documents" value={String(report.documentCount)} />
        <Meta label="Corpus seed" value={String(report.corpusSeed)} />
        <Meta label="Harness" value={`v${report.harnessVersion}`} />
      </dl>
      {report.note && (
        <p className="mt-4 rounded-md border-l-2 border-primary/50 bg-muted/40 px-4 py-2 text-sm">
          {report.note}
        </p>
      )}
      <pre className="mt-6 overflow-x-auto rounded-lg border bg-muted/40 px-4 py-3 text-xs leading-relaxed">
        <code>{`npm run eval:corpus\nnpm run eval -- --arms=${report.arms.map((a) => a.id).join(',')}`}</code>
      </pre>
    </header>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs">{value}</dd>
    </div>
  );
}

function SyntheticCaveat() {
  return (
    <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-relaxed">
      <p className="font-medium">These numbers are an upper bound, and here is why.</p>
      <p className="mt-2 text-muted-foreground">
        The corpus is synthetic by construction: a structured record is generated first and the
        document is rendered <em>from</em> it, so every label is exactly right and no real personal
        data is involved. The cost of that is realism — generated resumes are cleaner and more
        internally consistent than resumes people actually write, and they lack the genuinely
        ambiguous cases. Read the table below comparatively, arm against arm under identical
        conditions. The deltas are the measurement; the absolute level is a ceiling.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Headline({ arms }: { arms: PublicArm[] }) {
  const best = Math.max(...arms.map((a) => a.microF1Upper), 0.0001);
  return (
    <Section
      title="Headline"
      lead={
        <>
          Micro-F1 pools every field instance, so it is dominated by the numerous fields (skills).
          Macro-F1 averages the per-field scores, giving <code>email</code> the same weight as{' '}
          <code>skills</code>. They answer different questions, so both are here. Bars show the 95%
          bootstrap interval over documents.
        </>
      }
    >
      <Table
        head={
          <tr>
            <th className={th}>Arm</th>
            <th className={th}>Micro-F1 (95% CI)</th>
            <th className={thr}>Macro-F1</th>
            <th className={thr}>Precision</th>
            <th className={thr}>Recall</th>
            <th className={thr}>Scored</th>
            <th className={thr}>Not scored</th>
          </tr>
        }
      >
        {arms.map((arm) => (
          <tr key={arm.id}>
            <td className={td}>
              <div className="font-medium">{arm.label}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                {arm.provider} · {arm.strategy} · {arm.pdfStrategy}
              </div>
            </td>
            <td className={td}>
              <IntervalBar
                point={arm.microF1}
                lower={arm.microF1Lower}
                upper={arm.microF1Upper}
                scale={best}
              />
            </td>
            <td className={tdr}>{f3(arm.macroF1)}</td>
            <td className={tdr}>{f3(arm.precision)}</td>
            <td className={tdr}>{f3(arm.recall)}</td>
            <td className={tdr}>{arm.documentsScored}</td>
            <td className={tdr}>
              {arm.documentsFailed + arm.documentsSkipped === 0 ? (
                '—'
              ) : (
                <span title={Object.entries(arm.failureReasons).map(([k, n]) => `${n}× ${k}`).join(', ')}>
                  {arm.documentsFailed + arm.documentsSkipped}
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {arms.some((a) => a.documentsFailed + a.documentsSkipped > 0) && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {arms
            .filter((a) => a.documentsFailed + a.documentsSkipped > 0)
            .map((a) => (
              <li key={a.id}>
                <span className="font-medium text-foreground">{a.label}</span> did not score{' '}
                {a.documentsFailed + a.documentsSkipped} document(s) —{' '}
                {Object.entries(a.failureReasons)
                  .map(([k, n]) => `${n}× ${k}`)
                  .join(', ')}
                . Those contribute nothing to the metrics above rather than being scored as zeros.
              </li>
            ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * A point estimate with its confidence interval drawn to scale. The visual width
 * of the interval is the message: on a corpus this size several of them are wide
 * enough that ranking the arms by their point estimates would be overreading.
 */
function IntervalBar({
  point,
  lower,
  upper,
  scale,
}: {
  point: number;
  lower: number;
  upper: number;
  scale: number;
}) {
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className="min-w-[11rem]">
      <div className="font-mono text-xs tabular-nums">
        {f3(point)}{' '}
        <span className="text-muted-foreground">
          [{f3(lower)}, {f3(upper)}]
        </span>
      </div>
      <div className="relative mt-1.5 h-2 w-full rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/25"
          style={{ left: x(lower), right: `calc(100% - ${x(upper)})` }}
        />
        <div
          className="absolute inset-y-[-2px] w-[2px] rounded bg-primary"
          style={{ left: x(point) }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Comparisons({ report, baselineLabel }: { report: PublicReport; baselineLabel: string }) {
  return (
    <Section
      title="Arm comparisons"
      lead={
        <>
          Paired bootstrap over documents against <strong>{baselineLabel}</strong>. Paired because
          both arms saw the same corpus, so per-document difficulty cancels — which makes the test
          far more sensitive than eyeballing two intervals. Overlapping intervals in the table
          above do <em>not</em> mean a difference is insignificant.
        </>
      }
    >
      <Table
        head={
          <tr>
            <th className={th}>Candidate</th>
            <th className={thr}>Δ Micro-F1</th>
            <th className={th}>95% CI</th>
            <th className={th}>Verdict</th>
            <th className={thr}>Latency</th>
            <th className={thr}>Cost</th>
          </tr>
        }
      >
        {report.comparisons.map((c) => (
          <tr key={c.candidateId}>
            <td className={td}>
              <span className="font-mono text-xs">{c.candidateId}</span>
              {c.droppedDocuments > 0 && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {c.droppedDocuments} document(s) scored by only one arm were excluded.
                </div>
              )}
            </td>
            <td className={`${tdr} ${c.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {c.delta >= 0 ? '+' : ''}
              {f3(c.delta)}
            </td>
            <td className={`${td} font-mono text-xs text-muted-foreground`}>
              [{f3(c.lower)}, {f3(c.upper)}]
            </td>
            <td className={td}>
              <span
                className={
                  c.significant
                    ? 'rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400'
                    : 'rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                }
              >
                {c.significant
                  ? c.pValue < 0.001
                    ? 'p < 0.001'
                    : `p = ${c.pValue.toFixed(3)}`
                  : `not significant (p = ${c.pValue.toFixed(3)})`}
              </span>
            </td>
            <td className={tdr}>{c.latencyRatio ? `${c.latencyRatio.toFixed(2)}×` : '—'}</td>
            <td className={tdr}>{c.costRatio ? `${c.costRatio.toFixed(2)}×` : '—'}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Conditions({ arms }: { arms: PublicArm[] }) {
  const labels = arms[0]?.byCondition.map((c) => c.label) ?? [];
  if (labels.length === 0) return null;

  return (
    <Section
      title="By condition"
      lead={
        <>
          A 2×2 factorial: {'{'}single-column, two-column{'}'} × {'{'}digital, scanned{'}'}. Every
          record is rendered in all four cells, so layout and modality vary with the content held
          constant — which is what makes a difference between cells attributable to the cell rather
          than to a different pile of documents.
        </>
      }
    >
      <Table
        head={
          <tr>
            <th className={th}>Arm</th>
            {labels.map((l) => (
              <th key={l} className={thr}>
                {l.replace(/-/g, ' ')}
              </th>
            ))}
          </tr>
        }
      >
        {arms.map((arm) => (
          <tr key={arm.id}>
            <td className={`${td} font-mono text-xs`}>{arm.id}</td>
            {labels.map((label) => {
              const cell = arm.byCondition.find((c) => c.label === label);
              return (
                <td key={label} className={tdr}>
                  {cell ? (
                    <>
                      <span style={{ opacity: 0.35 + 0.65 * cell.f1 }} className="font-medium">
                        {f3(cell.f1)}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">n={cell.documents}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </Table>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function PerField({ arms }: { arms: PublicArm[] }) {
  const fields = Array.from(new Set(arms.flatMap((a) => a.perField.map((f) => f.field))));
  return (
    <Section
      title="Per-field precision, recall and F1"
      lead="Exact match after normalisation for email, phone and dates; token-overlap matching for names, titles, organisations and free text. Support is the number of field instances the ground truth actually contains."
    >
      <Table
        head={
          <tr>
            <th className={th}>Field</th>
            {arms.map((a) => (
              <th key={a.id} className={thr}>
                {a.id}
              </th>
            ))}
            <th className={thr}>Support</th>
          </tr>
        }
      >
        {fields.map((field) => {
          const best = Math.max(...arms.map((a) => a.perField.find((f) => f.field === field)?.f1 ?? 0));
          return (
            <tr key={field}>
              <td className={`${td} font-mono text-xs`}>{field}</td>
              {arms.map((arm) => {
                const row = arm.perField.find((f) => f.field === field);
                return (
                  <td key={arm.id} className={tdr}>
                    {row ? (
                      <span className={row.f1 >= best - 1e-9 ? 'font-semibold' : ''}>{f3(row.f1)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
              <td className={`${tdr} text-muted-foreground`}>
                {arms.map((a) => a.perField.find((f) => f.field === field)?.support).find((s) => s != null) ?? '—'}
              </td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Errors({ arms }: { arms: PublicArm[] }) {
  return (
    <Section
      title="Error analysis"
      lead="Every failed field instance gets exactly one category, assigned most-specific first. This is the part an accuracy number cannot tell you: two systems with the same F1 can fail in opposite ways, and a fabricated skill is far more dangerous in a hiring tool than a missing one."
    >
      <div className="grid gap-6 md:grid-cols-2">
        {arms.map((arm) => (
          <div key={arm.id} className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{arm.label}</h3>
            {arm.errorCounts.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No errors recorded.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {arm.errorCounts.map((e) => (
                  <li key={e.category}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs">
                        {e.category}
                        {e.informational && (
                          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            info
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {e.count}
                        {!e.informational && ` · ${pct(e.share)}`}
                      </span>
                    </div>
                    {!e.informational && (
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-rose-500/60"
                          style={{ width: `${Math.max(2, e.share * 100)}%` }}
                        />
                      </div>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{e.description}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Prompts trimmed to fit the token budget: <strong>{arm.truncatedPrompts}</strong> ·
              replies needing schema repair: <strong>{arm.repairedReplies}</strong> · requests that
              fell through to a fallback: <strong>{arm.failedOver}</strong>
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Calibration({ arms }: { arms: PublicArm[] }) {
  const withConfidence = arms.filter((a) => a.calibration.scored > 0);
  if (withConfidence.length === 0) return null;

  return (
    <Section
      title="Confidence calibration"
      lead={
        <>
          Two separate questions. <strong>Discrimination</strong> (AUROC): do higher-confidence
          extractions turn out right more often? <strong>Calibration</strong> (ECE): when the model
          says 0.8, is it right 80% of the time? A model can have one without the other, and which
          one it has decides whether the score is usable as a probability or only as a ranking.
        </>
      }
    >
      <Table
        head={
          <tr>
            <th className={th}>Arm</th>
            <th className={thr}>Scored</th>
            <th className={thr}>Unreported</th>
            <th className={thr}>Accuracy</th>
            <th className={thr}>Mean conf.</th>
            <th className={thr}>ECE ↓</th>
            <th className={thr}>Brier ↓</th>
            <th className={thr}>AUROC ↑</th>
          </tr>
        }
      >
        {withConfidence.map((arm) => (
          <tr key={arm.id}>
            <td className={`${td} font-mono text-xs`}>{arm.id}</td>
            <td className={tdr}>{arm.calibration.scored}</td>
            <td className={tdr}>{arm.calibration.unreported}</td>
            <td className={tdr}>{f3(arm.calibration.accuracy)}</td>
            <td className={tdr}>{f3(arm.calibration.meanConfidence)}</td>
            <td className={tdr}>{f3(arm.calibration.ece)}</td>
            <td className={tdr}>{f3(arm.calibration.brier)}</td>
            <td className={tdr}>{f3(arm.calibration.auroc)}</td>
          </tr>
        ))}
      </Table>

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        <strong>Unreported</strong> counts predictions the provider returned no confidence for. They
        are excluded rather than imputed — substituting a default would manufacture the signal being
        measured. Misses are excluded too: a model cannot be uncertain about a field it never
        mentioned.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {withConfidence.map((arm) => (
          <div key={arm.id}>
            <h3 className="text-sm font-semibold">{arm.label}</h3>
            <ReliabilityDiagram arm={arm} />
            <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Auto-accept operating points
            </h4>
            <Table
              head={
                <tr>
                  <th className={thr}>Threshold</th>
                  <th className={thr}>Accepted</th>
                  <th className={thr}>Accuracy</th>
                  <th className={thr}>Errors caught</th>
                </tr>
              }
            >
              {arm.routing.map((r) => (
                <tr key={r.threshold}>
                  <td className={tdr}>{r.threshold.toFixed(2)}</td>
                  <td className={tdr}>{pct(r.autoAcceptRate)}</td>
                  <td className={tdr}>{f3(r.autoAcceptAccuracy)}</td>
                  <td className={tdr}>{pct(r.errorsCaught)}</td>
                </tr>
              ))}
            </Table>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Reliability diagram: observed accuracy against reported confidence, per bin.
 * Bars below the diagonal are overconfidence. Drawn as inline SVG with no client
 * JavaScript.
 */
function ReliabilityDiagram({ arm }: { arm: PublicArm }) {
  const W = 320;
  const H = 220;
  const pad = { l: 34, r: 8, t: 8, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const bins = arm.calibration.bins;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Reliability diagram for ${arm.label}: observed accuracy against reported confidence`}
        className="w-full max-w-sm"
      >
        <rect
          x={pad.l}
          y={pad.t}
          width={plotW}
          height={plotH}
          className="fill-muted/40 stroke-border"
          strokeWidth={1}
        />
        {/* Perfect calibration */}
        <line
          x1={pad.l}
          y1={pad.t + plotH}
          x2={pad.l + plotW}
          y2={pad.t}
          className="stroke-muted-foreground"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        {bins.map((b) => {
          if (b.count === 0) return null;
          const x = pad.l + b.lower * plotW;
          const w = (b.upper - b.lower) * plotW;
          const h = b.accuracy * plotH;
          return (
            <g key={b.lower}>
              {/* Bin support, as a faint backdrop: a bin holding four observations
                  should not read as strongly as one holding four hundred. */}
              <rect
                x={x + 1}
                y={pad.t}
                width={w - 2}
                height={plotH}
                className="fill-primary"
                opacity={0.05 + 0.1 * (b.count / maxCount)}
              />
              <rect
                x={x + 1}
                y={pad.t + plotH - h}
                width={w - 2}
                height={h}
                className="fill-primary"
                opacity={0.75}
              />
              <circle
                cx={pad.l + b.meanConfidence * plotW}
                cy={pad.t + plotH - b.accuracy * plotH}
                r={2.5}
                className="fill-foreground"
              />
            </g>
          );
        })}
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <text x={pad.l - 6} y={pad.t + plotH - t * plotH + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
              {t.toFixed(1)}
            </text>
            <text x={pad.l + t * plotW} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={pad.l + plotW / 2} y={H - 0.5} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          reported confidence
        </text>
      </svg>
      <figcaption className="mt-1.5 text-xs text-muted-foreground">
        Bars are observed accuracy per confidence bin; the dashed line is perfect calibration. Bars
        below it mean overconfidence. Background shading shows how many observations each bin holds.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------

function CostLatency({ arms }: { arms: PublicArm[] }) {
  return (
    <Section
      title="Cost and latency"
      lead="Preprocessing — PDF text extraction or OCR — is reported separately from model latency, because it belongs to the pipeline rather than the model, and for a text-only provider it is often the larger of the two. Costs are computed from published list prices at the model that actually served each request."
    >
      <Table
        head={
          <tr>
            <th className={th}>Arm</th>
            <th className={thr}>Mean latency</th>
            <th className={thr}>p90</th>
            <th className={thr}>Preprocessing</th>
            <th className={thr}>Prompt tok.</th>
            <th className={thr}>Completion tok.</th>
            <th className={thr}>Cost / 1000 resumes</th>
          </tr>
        }
      >
        {arms.map((arm) => (
          <tr key={arm.id}>
            <td className={`${td} font-mono text-xs`}>{arm.id}</td>
            <td className={tdr}>{Math.round(arm.cost.meanLatencyMs)} ms</td>
            <td className={tdr}>{Math.round(arm.cost.p90LatencyMs)} ms</td>
            <td className={tdr}>{Math.round(arm.cost.meanPreprocessingMs)} ms</td>
            <td className={tdr}>{Math.round(arm.cost.meanPromptTokens)}</td>
            <td className={tdr}>{Math.round(arm.cost.meanCompletionTokens)}</td>
            <td className={tdr}>
              ${arm.cost.costPer1000ResumesUsd.toFixed(2)}
              {!arm.cost.allTokensReported && (
                <span className="ml-1 text-xs text-muted-foreground">est.</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Method({ report }: { report: PublicReport }) {
  return (
    <Section title="How this was measured">
      <div className="grid gap-5 md:grid-cols-2">
        <MethodCard title="Ground truth, built backwards">
          A structured record is generated first and the document is rendered from it, so labels are
          correct by construction rather than by annotator agreement. {report.documentCount}{' '}
          documents from seed <code>{report.corpusSeed}</code>; the labels are checked into the
          repository and the documents regenerate byte-identically from them.
        </MethodCard>
        <MethodCard title="One code path">
          The app and the harness reach the model through the same provider interface, prompt
          builder and retry policy. When those diverge, the eval measures something the product does
          not do.
        </MethodCard>
        <MethodCard title="Failures are recorded, not scored">
          A document the provider could not process is marked unscored, never counted as an
          extraction that got nothing right. Otherwise reliability leaks into accuracy and the two
          become impossible to separate.
        </MethodCard>
        <MethodCard title="Uncertainty, always">
          Every headline number carries a bootstrap interval resampled over documents — not over
          field instances, which are correlated within a resume and would give intervals several
          times too narrow. Every A-vs-B claim carries a paired test.
        </MethodCard>
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        Generated by the SkillParser evaluation harness v{report.harnessVersion} · run{' '}
        <code>{report.runId}</code> · {new Date(report.finishedAt).toUTCString()}
      </p>
    </Section>
  );
}

function MethodCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
