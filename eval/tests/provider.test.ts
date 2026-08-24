import { describe, it, assert, assertEqual, assertThrows } from './harness';
import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  GroqProvider,
  groqPricingFor,
} from '../../src/lib/llm/providers/groq';
import { parseResumeText } from '../../src/lib/llm/providers/heuristic';
import {
  CapabilityUnavailableError,
  PromptTooLargeError,
  ProviderError,
} from '../../src/lib/llm/errors';
import { coerceParsedResume } from '../../src/lib/resume-schema';
import { generateRecord } from '../corpus/records';
import { layoutResume } from '../corpus/layout';
import { renderPdf } from '../corpus/render';
import type { ResumeDocument } from '../../src/lib/llm/types';

const RESUME_TEXT = `Ifeoma Nakamura
ifeoma.nakamura@mailbox.dev | +91 74097 09968 | Pune, India

EXPERIENCE

Staff Software Engineer
Halcyon Grid Systems | Jan 2023 - Present
- Cut p99 checkout latency from 840ms to 210ms.

Backend Engineer
Umbra Robotics | Jun 2020 - Dec 2022
- Migrated 43 services off a shared Postgres instance.

EDUCATION

B.Tech in Computer Science and Engineering
Fenwold University | May 2020

SKILLS
Go, Kafka, PostgreSQL`;

async function pdfDocument(seed = 31337): Promise<ResumeDocument> {
  const record = generateRecord('rT', seed);
  const bytes = new Uint8Array(await renderPdf(layoutResume(record, 'single-column')));
  return { id: 'rT', kind: 'pdf', mimeType: 'application/pdf', bytes };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Groq provider', () => {
  it('does not retry an oversized request', async () => {
    // Waiting cannot make a request smaller. Retrying a 413 with backoff spends the
    // whole retry budget and then fails with the same error minutes later.
    let calls = 0;
    const provider = new GroqProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 19004',
          { status: 413 }
        );
      },
      sleep: async () => {},
    });
    const doc = await pdfDocument();
    await assertThrows(
      () => provider.parse(doc, { strategy: 'zero-shot' }),
      (err) => err instanceof PromptTooLargeError,
      'should raise PromptTooLargeError'
    );
    assertEqual(calls, 1, 'an oversized request must be attempted exactly once');
  });

  it('retries a rate limit and honours the provider’s own wait hint', async () => {
    let calls = 0;
    const slept: number[] = [];
    const provider = new GroqProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) {
          return new Response('Rate limit reached. Please try again in 2.5s.', { status: 429 });
        }
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ personal: { name: 'A B' }, skills: [] }) } }],
          usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
        });
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const result = await provider.parse(await pdfDocument(), { strategy: 'zero-shot' });
    assertEqual(calls, 3);
    assertEqual(result.attempts, 3);
    assertEqual(slept, [2500, 2500], 'should sleep exactly as long as the provider asked');
    assertEqual(result.usage.reported, true);
    assertEqual(result.usage.promptTokens, 900);
  });

  it('refuses to start when the reply reservation alone exceeds the ceiling', async () => {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      tpmLimit: 1000,
      completionTokens: 2500,
      fetchImpl: async () => {
        throw new Error('the network should never be reached');
      },
    });
    const doc = await pdfDocument();
    await assertThrows(
      () => provider.parse(doc, { strategy: 'few-shot' }),
      (err) => err instanceof PromptTooLargeError,
      'should fail before spending a request'
    );
  });

  it('keeps the request under the ceiling for a long few-shot prompt', async () => {
    let sentTokensEstimate = 0;
    const tpmLimit = 12_000;
    const completionTokens = 2000;
    const provider = new GroqProvider({
      apiKey: 'test-key',
      tpmLimit,
      completionTokens,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String((init as RequestInit).body));
        const chars = payload.messages.map((m: { content: string }) => m.content).join('').length;
        sentTokensEstimate = Math.ceil(chars / 3) + payload.max_tokens;
        return jsonResponse({
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });
    await provider.parse(await pdfDocument(4242), { strategy: 'few-shot' });
    assert(
      sentTokensEstimate < tpmLimit,
      `projected ${sentTokensEstimate} tokens against a ${tpmLimit} ceiling`
    );
  });

  it('rejects a missing API key without touching the network', async () => {
    const provider = new GroqProvider({ apiKey: '' });
    assertEqual(provider.isConfigured(), false);
    const doc = await pdfDocument();
    await assertThrows(
      () => provider.parse(doc, { strategy: 'zero-shot' }),
      (err) => err instanceof ProviderError && err.kind === 'auth',
      'should raise an auth error'
    );
  });

  it('sends an image to the vision model and a PDF to the text model', async () => {
    // The modality ablation depends entirely on this routing being right. If a scan
    // quietly went to the text model the arm would measure nothing, and the failure
    // would look like a bad accuracy number rather than a bug.
    const seen: Array<{ model: string; hasImage: boolean }> = [];
    const provider = new GroqProvider({
      apiKey: 'test-key',
      id: 'groq-vision',
      visionModel: 'vision-model-x',
      model: 'text-model-y',
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String((init as RequestInit).body));
        const content = payload.messages[1].content;
        seen.push({
          model: payload.model,
          hasImage: Array.isArray(content) && content.some((c: any) => c.type === 'image_url'),
        });
        return jsonResponse({
          choices: [{ message: { content: '{"personal":{"name":"A B"},"skills":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      },
    });

    const pdf = await pdfDocument();
    const image: ResumeDocument = {
      id: 'scan',
      kind: 'image',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
    };

    const pdfResult = await provider.parse(pdf, { strategy: 'zero-shot', model: 'text-model-y' });
    const imageResult = await provider.parse(image, { strategy: 'zero-shot', model: 'text-model-y' });

    assertEqual(seen[0], { model: 'text-model-y', hasImage: false });
    assertEqual(seen[1], { model: 'vision-model-x', hasImage: true });
    assertEqual(pdfResult.preprocessing.path, 'pdf-text-layer');
    assertEqual(imageResult.preprocessing.path, 'native-multimodal');
    assertEqual(imageResult.modelId, 'vision-model-x');
  });

  it('ignores the arm text-model override on the vision path', async () => {
    // `options.model` is the arm's text model. Routing an image to it produces a
    // confusing 400 rather than a useful result, so the vision path must not honour it.
    let usedModel = '';
    const provider = new GroqProvider({
      apiKey: 'test-key',
      visionModel: 'vision-model-x',
      fetchImpl: async (_url, init) => {
        usedModel = JSON.parse(String((init as RequestInit).body)).model;
        return jsonResponse({
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });
    await provider.parse(
      { id: 'scan', kind: 'image', mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) },
      { strategy: 'zero-shot', model: 'some-text-model' }
    );
    assertEqual(usedModel, 'vision-model-x');
  });

  it('routes images through OCR when no vision model is configured', async () => {
    // Which is why the OCR path still has to exist: the only image-capable model on
    // Groq is a preview model, and preview models are withdrawn at short notice.
    const provider = new GroqProvider({ apiKey: 'test-key' });
    assertEqual(provider.supportsNativeDocuments, false);
    await assertThrows(
      () =>
        provider.parse(
          { id: 'scan', kind: 'image', mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) },
          { strategy: 'zero-shot' }
        ),
      (err) => err instanceof CapabilityUnavailableError || err instanceof ProviderError,
      'should attempt OCR rather than silently sending an image to a text model'
    );
  });

  it('refuses a vision request whose instructions alone leave no room for the image', async () => {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      visionModel: 'vision-model-x',
      tpmLimit: 1200,
      completionTokens: 1000,
      fetchImpl: async () => {
        throw new Error('the network should never be reached');
      },
    });
    await assertThrows(
      () =>
        provider.parse(
          { id: 'scan', kind: 'image', mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) },
          { strategy: 'few-shot' }
        ),
      (err) => err instanceof PromptTooLargeError,
      'should fail before spending a request'
    );
  });

  it('prices the model that answered, and flags an unknown one rather than pricing it at zero', () => {
    assert(groqPricingFor(DEFAULT_TEXT_MODEL).inputPerMillion > 0, 'default text model must be priced');
    const unknown = groqPricingFor('some/model-nobody-added');
    assert(unknown.source.includes('unknown'), `unpriced models must say so: ${unknown.source}`);
  });

  it('defaults to models that exist in Groq\'s production catalogue', () => {
    // Pinned so a careless edit cannot reintroduce a shut-down model id. Both were
    // verified against console.groq.com/docs/models on 2026-08-24; run
    // `npm run groq:check` to confirm against your own key.
    assertEqual(DEFAULT_TEXT_MODEL, 'openai/gpt-oss-120b');
    assertEqual(DEFAULT_VISION_MODEL, 'qwen/qwen3.6-27b');
  });

  it('recovers JSON from a reply wrapped in prose or fences', async () => {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: 'Here is the JSON:\n```json\n{"personal":{"name":"Ifeoma Nakamura"},"skills":["Go"]}\n```',
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
    });
    const result = await provider.parse(await pdfDocument(), { strategy: 'zero-shot' });
    assertEqual(result.parsed.personal.name, 'Ifeoma Nakamura');
    assertEqual(result.parsed.skills, ['Go']);
  });
});

describe('schema coercion', () => {
  it('repairs a reply that omits the personal block', () => {
    const { value, repaired } = coerceParsedResume({
      name: 'Ifeoma Nakamura',
      email: 'i@example.com',
      skills: ['Go'],
    });
    assertEqual(value.personal.name, 'Ifeoma Nakamura');
    assert(repaired.includes('personal:absent'), 'the repair should be recorded, not silent');
  });

  it('accepts the aliases models commonly substitute', () => {
    const { value } = coerceParsedResume({
      experience: [{ role: 'Backend Engineer', employer: 'Umbra Robotics', dates: '2020 - 2022' }],
    });
    assertEqual(value.experience[0].title, 'Backend Engineer');
    assertEqual(value.experience[0].company, 'Umbra Robotics');
    assertEqual(value.experience[0].duration, '2020 - 2022');
  });

  it('drops nulls rather than rendering them as the string "null"', () => {
    const { value } = coerceParsedResume({ personal: { name: null }, skills: [null, 'Go'] });
    assertEqual(value.personal.name, '');
    assertEqual(value.skills, ['Go']);
  });

  it('reports no repairs for a fully conforming reply', () => {
    const { repaired } = coerceParsedResume({
      personal: { name: 'A B', email: '', phone: '', location: '' },
      skills: [],
      experience: [],
      education: [],
      certifications: [],
    });
    assertEqual(repaired, []);
  });
});

describe('rule-based baseline', () => {
  it('extracts the fields a strict regex can be sure about', () => {
    const parsed = parseResumeText(RESUME_TEXT, true);
    assertEqual(parsed.personal.email, 'ifeoma.nakamura@mailbox.dev');
    assertEqual(parsed.personal.name, 'Ifeoma Nakamura');
    assertEqual(parsed.experience.length, 2);
    assertEqual(parsed.education.length, 1);
    assert(parsed.skills.includes('Kafka'), `skills were ${parsed.skills.join(', ')}`);
  });

  it('does not mistake the digits in an email address for a phone number', () => {
    const parsed = parseResumeText('Ifeoma Nakamura\nifeoma.nakamura2024@mailbox.dev\n', true);
    assertEqual(parsed.personal.phone, '');
  });

  it('reports low confidence for fields it had to guess', () => {
    // Real confidence rather than constants is what gives the calibration analysis
    // something to measure on the offline path.
    const parsed = parseResumeText(RESUME_TEXT, true);
    assert((parsed.confidence?.email ?? 0) > 0.9, 'a regex match should be confident');
    const noEmail = parseResumeText('Ifeoma Nakamura\nPune, India\n', true);
    assert((noEmail.confidence?.email ?? 1) < 0.2, 'an absent field should not be confident');
  });

  it('omits confidence entirely when it is not requested', () => {
    const parsed = parseResumeText(RESUME_TEXT, false);
    assertEqual(parsed.confidence, undefined);
    assertEqual(parsed.experience[0].confidence, undefined);
  });
});
