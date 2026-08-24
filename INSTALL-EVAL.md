# Setup & verification

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY
npm run groq:check        # confirm the key can reach the configured models
```

Then, in order:

```bash
npm run eval:test         # 106 offline assertions — no network, no API key
npm run eval:corpus       # regenerate 60 records × 4 conditions from checked-in labels
npm run eval              # run the configured arms, rebuild the report and /eval
npm run typecheck
npm run build
npm run dev               # http://localhost:9002/eval
```

`npm run eval` skips any arm whose API key is missing and says so, so a clone with
no keys still produces a complete report from the offline arms.

## What's measured versus what's designed

The [`eval/`](eval/) framework — corpus generator, scoring harness, error taxonomy,
calibration analysis, bootstrap statistics — has been run end to end: a real
60-record × 4-condition (240-document) pass of the offline arms gives `heuristic`
micro-F1 0.731 [0.673, 0.786] and `heuristic-naive-pdf` micro-F1 0.408 [0.346, 0.469],
with the two-column collapse specifically at 0.734 → 0.148 and a baseline AUROC of
0.391 — below chance, reported as a finding rather than dropped. Full numbers and
method are in [`eval/README.md`](eval/README.md) and at `/eval`.

Running the LLM arms themselves needs a live `GROQ_API_KEY` reachable from wherever
`npm run eval` executes:

```bash
npm run eval -- --arms=heuristic,groq-zero-shot,groq-few-shot,groq-naive-pdf,groq-vision-few-shot
```

Start with `--condition=primary --limit=20` to check the wiring before spending the
full token budget — responses are cached, so re-running after a metrics change (not
a prompt change) costs nothing.

The persistence and authentication layer described in `README.md`
(`supabase/migrations/0001_init.sql`, `src/lib/db/`, `src/auth.ts`) is implemented
at the code level and not yet wired into the running app — see that section of the
README for the setup steps and what's left.

## Housekeeping

- **Line endings.** If `git status` shows nearly every file as modified with no
  visible diff, that's CRLF/LF normalization, not real content. A `.gitattributes`
  plus `git add --renormalize .` as its own commit resolves it cleanly.
- **Dead Firebase scaffolding** (`src/firebase/`, `firestore.rules`) is unreferenced
  outside itself and not mounted in `layout.tsx` — scheduled for removal alongside
  the database migration landing.
