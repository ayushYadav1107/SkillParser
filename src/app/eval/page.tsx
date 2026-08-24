/**
 * @fileOverview The public evaluation report at `/eval`.
 *
 * This is the page a reviewer sees without cloning anything, and it is the reason
 * the eval exists in a form other than a script somebody ran once. It reads the
 * summary the harness writes at `src/lib/eval/latest-report.json`, which is a
 * static import — so the page is fully rendered at build time, has no data
 * fetching, and cannot show a number the checked-in artifact does not contain.
 *
 * Regenerate it with `npm run eval`.
 */

import type { Metadata } from 'next';

import { ReportView } from '@/components/eval/report-view';
import type { PublicReport } from '@/lib/eval/types';
import report from '@/lib/eval/latest-report.json';

export const metadata: Metadata = {
  title: 'Evaluation report · SkillParser',
  description:
    'Field-level precision, recall and F1 for resume extraction, with bootstrap confidence intervals, error taxonomy, confidence calibration, and cost/latency comparison across providers.',
};

export default function EvalPage() {
  return <ReportView report={report as PublicReport} />;
}
