# Installing this upgrade

This file tracks what has actually been delivered into this repository so far, in
the order it happened. Read `README.md` first for the current architecture; this is
the install/verification checklist and the changelog of what shipped versus what is
still sitting as drafted files.

```bash
cd "C:\college stuff\3rd Year\NLP"
npm install
npm run groq:check        # confirm your GROQ_API_KEY can reach the configured models
```

Then verify, in this order:

```bash
npm run eval:test         # 106 offline assertions — no network, no API key
npm run eval:corpus       # regenerate 60 records × 4 conditions from checked-in labels
npm run eval              # run the configured arms, rebuild the report and /eval
npm run typecheck
npm run build
npm run dev               # visit http://localhost:9002/eval
```

`npm run eval` skips any arm whose API key is missing and says so, so it produces a
complete report from the offline arms alone.

## What has shipped and been verified on this machine

1. **The evaluation framework** (`eval/`) — corpus generator, scoring harness,
   error taxonomy, calibration analysis, bootstrap statistics, 106 tests. Verified
   with a real 60-record × 4-condition = 240-document run of the offline arms:
   `heuristic` micro-F1 0.731 [0.673, 0.786], `heuristic-naive-pdf` micro-F1 0.408
   [0.346, 0.469] (two-column collapse specifically 0.734 → 0.148), baseline AUROC
   0.391 — below chance, reported as an honest negative finding rather than dropped.
2. **The Groq-only provider architecture.** The original design compared Gemini
   against Groq across vendors. It was reworked to run entirely on Groq
   (`groq-vision` → `groq` → `heuristic`), which is the cleaner experiment: modality
   is now the only thing that differs between the vision and text arms, not vendor,
   endpoint, retry policy, and prompt all at once. Model choice
   (`openai/gpt-oss-120b` for text, `qwen/qwen3.6-27b` for vision) was checked
   against Groq's live model and rate-limit tables rather than assumed from training
   data, because `llama-3.3-70b-versatile` — an otherwise-plausible default — turned
   out to be absent from both.
3. **The security fix in `src/ai/genkit.ts`.** A hardcoded Gemini API key was
   removed. **It is still live in this repository's git history and has not been
   rotated as far as this session knows** — rotate it at
   <https://aistudio.google.com/apikey> regardless of whether Gemini is still used.
4. **The `/eval` report page**, rendering the summary above from
   `src/lib/eval/latest-report.json`.

## What exists only as drafted files, not yet installed or wired in

See the "Data & authentication layer" section in `README.md` for the full table.
Short version: a Postgres schema (`supabase/migrations/0001_init.sql`), a
typed data-access layer (`src/lib/db/client.ts`, `src/lib/db/reports.ts`), and an
Auth.js v5 replacement for the old password-ignoring, `localStorage`-based login
(`src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`) were written in a sandbox
session but:

- `next-auth@beta`, `pg`, and `@auth/pg-adapter` were never confirmed installed —
  the sandbox's package manifest never picked them up, so treat this as **not
  installed**, not merely unverified.
- Nothing calls `saveExtraction()` from the extract route yet, no page reads
  `listHistory()`, and no route is gated behind a session.
- Neither `npm run typecheck` nor `npm run build` has been run against this code.

Bringing this online needs, in order: install the three packages above, add
`DATABASE_URL` and `AUTH_SECRET`/`AUTH_GITHUB_*` or `AUTH_GOOGLE_*` to `.env`, run
the migration against a real Postgres (a free Supabase project is what the schema
was designed against), then wire the extract route and a dashboard page to the data
layer. None of that is done yet.

## Housekeeping still outstanding

- **CRLF/LF.** If `git status` shows nearly every file as modified with no visible
  diff, that's line-ending normalization, not real content. A `.gitattributes` plus
  `git add --renormalize .` as its own commit fixes this without mixing it into a
  real change.
- **The leaked Gemini key** (see above) — rotate it independently of anything else
  in this list; deleting the line from source does not revoke the key.
- Dead Firebase scaffolding (`src/firebase/`, `firestore.rules`) is unreferenced
  outside itself and not mounted in `layout.tsx`, but has not been removed yet —
  left in place rather than deleted opportunistically while other things were
  mid-flight.

## Running the real LLM arms

Neither the sandbox this work was drafted in nor the device bridge to this machine
could reach `api.groq.com`, so only the offline arms (`heuristic`,
`heuristic-naive-pdf`) have actually been executed and have real measured numbers.
With `GROQ_API_KEY` set in `.env`, run the Groq arms directly on this machine:

```bash
npm run eval -- --arms=heuristic,groq-zero-shot,groq-few-shot,groq-naive-pdf,groq-vision-few-shot
```

Start with `--condition=primary --limit=20` to check the wiring before spending the
full token budget. Responses are cached, so re-running after a change to the
*metrics* (not the prompts) costs nothing.
