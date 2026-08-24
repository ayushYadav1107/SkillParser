/**
 * @fileOverview Offline test suite. `npm run eval:test`.
 *
 * Everything here runs without a network and without an API key, and every test is
 * about the *evaluator* rather than the models. That is the point: an evaluation
 * harness is a measuring instrument, and an uncalibrated instrument produces
 * confident numbers that are wrong in ways nobody notices. If the entry aligner
 * mismatches two roles at the same employer, every downstream metric shifts and the
 * report still looks perfectly reasonable.
 *
 * The cases below are mostly the ones that were actually got wrong while building
 * this — a truncation marker that pushed a trimmed section back over its own
 * budget, a 413 classified as a rate limit because the provider's wording contains
 * "tokens per minute", a greedy aligner that mismatched a promotion. Each is
 * pinned so it cannot come back.
 */

import { runAll } from './harness';

import './budget.test';
import './errors.test';
import './normalize.test';
import './similarity.test';
import './align.test';
import './score.test';
import './calibration.test';
import './stats.test';
import './corpus.test';
import './provider.test';
import './contamination.test';

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
