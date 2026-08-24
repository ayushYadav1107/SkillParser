/**
 * @fileOverview The experimental arms.
 *
 * Named presets rather than command-line flags, because an arm is a *hypothesis*
 * and hypotheses should be written down. `--arms=groq-zero-shot,groq-few-shot`
 * says what is being tested; a pile of flags reconstructed from shell history does
 * not, and six weeks later nobody can reproduce what was actually compared.
 *
 * Each arm changes exactly one thing relative to another, which is what makes the
 * deltas attributable:
 *
 *   heuristic            — no model at all. The floor every LLM arm has to clear.
 *   heuristic-naive-pdf  — heuristic with the column-aware PDF preprocessor swapped
 *                          for content-stream order. Isolates the preprocessor with
 *                          the parser held fixed.
 *   groq-zero-shot       — the shipping configuration.
 *   groq-few-shot        — groq-zero-shot plus two worked examples. Isolates
 *                          prompting, and nothing else: same model, same
 *                          preprocessing, same retry policy.
 *   groq-naive-pdf       — groq-few-shot with the naive preprocessor. The same
 *                          ablation as heuristic-naive-pdf, now on the LLM path.
 *                          The interesting question is whether the model repairs
 *                          bad reading order that destroys a rule-based parser.
 *   groq-vision-few-shot — groq-few-shot with scans sent to a multimodal model as
 *                          images instead of through OCR. Isolates the modality.
 *
 * Everything now runs against one vendor, which is a better experiment than the
 * cross-vendor comparison it replaced: endpoint, retry policy, token budgeting and
 * prompt are all held constant, so a difference between arms is the model or the
 * pipeline rather than two providers' unrelated engineering.
 */

import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../src/lib/llm/providers/groq';
import type { ArmSpec } from './types';

/**
 * Resolved once at load. Groq's catalogue churns, so an arm names a model but lets
 * the environment override it — a reviewer whose key cannot see the default should
 * be able to reproduce the experiment by setting one variable, not by editing this
 * file.
 */
const TEXT_MODEL = process.env.GROQ_MODEL ?? DEFAULT_TEXT_MODEL;
const VISION_MODEL = process.env.GROQ_VISION_MODEL ?? DEFAULT_VISION_MODEL;

export const ARM_PRESETS: Record<string, ArmSpec> = {
  heuristic: {
    id: 'heuristic',
    label: 'Rule-based baseline',
    provider: 'heuristic',
    model: 'rules-v1',
    strategy: 'zero-shot',
    pdfStrategy: 'column-aware',
    requestConfidence: true,
  },
  'heuristic-naive-pdf': {
    id: 'heuristic-naive-pdf',
    label: 'Rule-based baseline · naive PDF extraction',
    provider: 'heuristic',
    model: 'rules-v1',
    strategy: 'zero-shot',
    pdfStrategy: 'naive',
    requestConfidence: true,
  },
  'groq-zero-shot': {
    id: 'groq-zero-shot',
    label: `Groq ${TEXT_MODEL} · zero-shot`,
    provider: 'groq',
    model: TEXT_MODEL,
    strategy: 'zero-shot',
    pdfStrategy: 'column-aware',
    requestConfidence: true,
  },
  'groq-few-shot': {
    id: 'groq-few-shot',
    label: `Groq ${TEXT_MODEL} · few-shot`,
    provider: 'groq',
    model: TEXT_MODEL,
    strategy: 'few-shot',
    pdfStrategy: 'column-aware',
    requestConfidence: true,
  },
  'groq-naive-pdf': {
    id: 'groq-naive-pdf',
    label: `Groq ${TEXT_MODEL} · few-shot · naive PDF extraction`,
    provider: 'groq',
    model: TEXT_MODEL,
    strategy: 'few-shot',
    pdfStrategy: 'naive',
    requestConfidence: true,
  },
  'groq-vision-few-shot': {
    id: 'groq-vision-few-shot',
    label: `Groq ${VISION_MODEL} (vision on scans) · few-shot`,
    provider: 'groq-vision',
    // The text model, used for the PDF conditions. Scans go to the vision model,
    // which the provider selects itself — see the note in parseWithVision.
    model: TEXT_MODEL,
    strategy: 'few-shot',
    pdfStrategy: 'column-aware',
    requestConfidence: true,
  },
  'groq-no-confidence': {
    id: 'groq-no-confidence',
    label: `Groq ${TEXT_MODEL} · few-shot · confidence not requested`,
    provider: 'groq',
    model: TEXT_MODEL,
    strategy: 'few-shot',
    pdfStrategy: 'column-aware',
    // Asking for per-field confidence costs output tokens and may cost accuracy.
    // This arm measures whether it does.
    requestConfidence: false,
  },
};

/**
 * Run when `--arms` is not given. Unconfigured providers are dropped at startup
 * with a message rather than failing the run, so a clone with no API key still
 * produces a complete report from the offline arms.
 */
export const DEFAULT_ARMS = [
  'heuristic',
  'heuristic-naive-pdf',
  'groq-zero-shot',
  'groq-few-shot',
  'groq-naive-pdf',
  'groq-vision-few-shot',
];

export function resolveArms(ids: string[]): ArmSpec[] {
  return ids.map((id) => {
    const preset = ARM_PRESETS[id];
    if (!preset) {
      throw new Error(`Unknown arm "${id}". Available: ${Object.keys(ARM_PRESETS).join(', ')}`);
    }
    return preset;
  });
}
