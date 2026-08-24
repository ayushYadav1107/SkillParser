/**
 * One-time setup for the evaluation framework.
 *
 *   node scripts/setup-eval.mjs
 *
 * Adds the npm scripts and dependencies the harness needs, extends .gitignore for
 * the generated corpus and the response cache, and prints what to run next. Safe to
 * re-run: every edit checks whether it has already been applied.
 *
 * Written as a plain Node script rather than a shell script so it works the same on
 * Windows, which is where this repository lives.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCRIPTS = {
  'eval:corpus': 'tsx eval/corpus/generate.ts',
  'eval:test': 'tsx eval/tests/index.ts',
  eval: 'tsx eval/run_eval.ts',
  'groq:check': 'tsx eval/check-groq.ts',
};

const DEPENDENCIES = {
  pdfkit: '^0.20.1',
  '@napi-rs/canvas': '^1.0.8',
  unpdf: '^1.8.1',
  mammoth: '^1.12.1',
};

const DEV_DEPENDENCIES = {
  '@types/pdfkit': '^0.17.6',
  tsx: '^4.21.0',
};

const GITIGNORE_BLOCK = `
# evaluation framework
# Rendered documents are derived from the checked-in labels; regenerate with
# \`npm run eval:corpus\`. Full run artifacts carry every field observation and run to
# a few megabytes each — the aggregated summaries in eval/results/history/ are what
# gets committed.
eval/ground_truth/documents/
eval/results/runs/
eval/results/cache/
.tesseract-cache/
`;

function patchPackageJson() {
  const path = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const added = { scripts: [], deps: [], devDeps: [] };

  pkg.scripts ??= {};
  for (const [name, cmd] of Object.entries(SCRIPTS)) {
    if (pkg.scripts[name] !== cmd) {
      pkg.scripts[name] = cmd;
      added.scripts.push(name);
    }
  }

  pkg.dependencies ??= {};
  for (const [name, version] of Object.entries(DEPENDENCIES)) {
    if (!pkg.dependencies[name]) {
      pkg.dependencies[name] = version;
      added.deps.push(name);
    }
  }

  pkg.devDependencies ??= {};
  for (const [name, version] of Object.entries(DEV_DEPENDENCIES)) {
    if (!pkg.devDependencies[name]) {
      pkg.devDependencies[name] = version;
      added.devDeps.push(name);
    }
  }

  // Keep dependency blocks alphabetical so the diff stays readable.
  pkg.dependencies = sortKeys(pkg.dependencies);
  pkg.devDependencies = sortKeys(pkg.devDependencies);

  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return added;
}

function patchGitignore() {
  const path = join(root, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.includes('eval/ground_truth/documents/')) return false;
  writeFileSync(path, `${current.trimEnd()}\n${GITIGNORE_BLOCK}`, 'utf8');
  return true;
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

const added = patchPackageJson();
const gitignoreChanged = patchGitignore();

console.log('package.json');
console.log(`  scripts added:      ${added.scripts.join(', ') || '(already present)'}`);
console.log(`  dependencies added: ${added.deps.join(', ') || '(already present)'}`);
console.log(`  devDependencies:    ${added.devDeps.join(', ') || '(already present)'}`);
console.log(`.gitignore            ${gitignoreChanged ? 'extended' : '(already extended)'}`);

console.log(`
Next:

  npm install
  npm run groq:check        # what models can this API key actually reach?
  npm run eval:test         # 106 offline assertions, no network or API key needed
  npm run eval:corpus       # regenerate 60 records x 4 conditions (~3 MB, gitignored)
  npm run eval              # run every configured arm, rebuild the report and /eval
  npm run typecheck
  npm run build

Put your Groq key in .env as GROQ_API_KEY (see .env.example):
https://console.groq.com/keys

Gemini is no longer used, but the key that was committed to this repository's public
history in src/ai/genkit.ts is still live. Deleting the line did not revoke it —
rotate it at https://aistudio.google.com/apikey.
`);
