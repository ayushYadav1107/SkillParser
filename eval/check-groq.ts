/**
 * @fileOverview Preflight: what can this key actually see? `npm run groq:check`
 *
 * Groq retires models faster than most providers — the Llama 3.2 vision previews
 * went in April 2025, Llama 4 Maverick and Scout during 2026 — and the failure mode
 * is a 404 forty documents into an evaluation run that has already spent real
 * quota. This asks the API up front and says plainly whether the models the arms
 * name are available, so the answer arrives before the run instead of during it.
 */

import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  listGroqModels,
} from '../src/lib/llm/providers/groq';

async function main(): Promise<void> {
  const configuredText = process.env.GROQ_MODEL ?? DEFAULT_TEXT_MODEL;
  const configuredVision = process.env.GROQ_VISION_MODEL ?? DEFAULT_VISION_MODEL;

  if (!process.env.GROQ_API_KEY) {
    console.error(
      'GROQ_API_KEY is not set. Copy .env.example to .env and add your key from\n' +
        'https://console.groq.com/keys — then re-run `npm run groq:check`.'
    );
    process.exit(1);
  }

  let available: string[];
  try {
    available = await listGroqModels();
  } catch (err) {
    console.error(`Could not reach the Groq API: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  console.log(`Models visible to this key (${available.length}):\n`);
  for (const id of available) {
    const marks = [
      id === configuredText ? 'text arms' : null,
      id === configuredVision ? 'vision arm' : null,
    ].filter(Boolean);
    console.log(`  ${id}${marks.length ? `   ← ${marks.join(', ')}` : ''}`);
  }

  console.log('');
  const textOk = available.includes(configuredText);
  const visionOk = available.includes(configuredVision);

  report('Text model  ', configuredText, textOk, 'GROQ_MODEL');
  report('Vision model', configuredVision, visionOk, 'GROQ_VISION_MODEL');

  if (!textOk) {
    console.log(
      '\nThe text arms cannot run. Pick an available id from the list above and set\n' +
        'GROQ_MODEL in .env — the arms read it, so no code change is needed.'
    );
    process.exit(1);
  }

  if (!visionOk) {
    console.log(
      '\nThe vision arm cannot run, which is survivable: scanned resumes will go\n' +
        'through OCR on the text path instead, and the report will say so. If another\n' +
        'image-capable model appears in the list above, set GROQ_VISION_MODEL to it.'
    );
  }

  console.log('\nFree-tier ceiling is per-organisation. Confirm yours at');
  console.log('https://console.groq.com/settings/limits and set GROQ_TPM_LIMIT to match.');
}

function report(label: string, model: string, ok: boolean, envVar: string): void {
  console.log(`${label}  ${model.padEnd(32)} ${ok ? 'available' : `NOT AVAILABLE (set ${envVar})`}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('eval/check-groq.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
