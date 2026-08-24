/**
 * @fileOverview Path resolution for the eval harness.
 *
 * Deliberately avoids `import.meta.url`. The host project is a CommonJS package
 * (no `"type": "module"` in package.json), and `import.meta` is a syntax error
 * under CJS emit — so a harness that used it would run under `tsx` today and break
 * the moment anyone typechecked or bundled it. Walking up from the working
 * directory for the marker files works identically under both module systems and
 * under `tsc --noEmit`.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

let cachedRoot: string | null = null;

/** Nearest ancestor of the working directory containing both package.json and eval/. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'eval'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the repository root from ${process.cwd()}. Run the eval scripts from the project directory.`
  );
}

export const paths = {
  get evalDir() {
    return join(repoRoot(), 'eval');
  },
  get groundTruthDir() {
    return join(this.evalDir, 'ground_truth');
  },
  get recordsDir() {
    return join(this.groundTruthDir, 'records');
  },
  get documentsDir() {
    return join(this.groundTruthDir, 'documents');
  },
  get manifestPath() {
    return join(this.groundTruthDir, 'manifest.json');
  },
  get resultsDir() {
    return join(this.evalDir, 'results');
  },
  get cacheDir() {
    return join(this.resultsDir, 'cache');
  },
  get runsDir() {
    return join(this.resultsDir, 'runs');
  },
  /** Aggregated summaries. Small enough to check in; the full artifacts are not. */
  get historyDir() {
    return join(this.resultsDir, 'history');
  },
  get reportsDir() {
    return join(this.resultsDir, 'reports');
  },
  /** Consumed by the public /eval page, so it lives where Next can import it. */
  get publicReportPath() {
    return join(repoRoot(), 'src', 'lib', 'eval', 'latest-report.json');
  },
};
