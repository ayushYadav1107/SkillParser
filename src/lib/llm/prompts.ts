/**
 * @fileOverview Prompt construction, shared by every provider.
 *
 * One builder for all providers is a requirement of the experiment, not a
 * convenience: the zero-shot vs. few-shot arm and the Gemini vs. Groq arm are only
 * interpretable if the prompt text is identical across them. The single thing that
 * legitimately varies is how the *document* is attached — inline as an image part
 * for a multimodal provider, or as extracted text for a text-only one.
 *
 * Contamination note
 * ------------------
 * The few-shot exemplars below are hand-written and share no names, companies,
 * schools or skills with the generated evaluation corpus (`eval/corpus/pools.ts`).
 * Drawing exemplars from the same pools would leak the answer distribution into the
 * prompt and inflate the few-shot arm for reasons that have nothing to do with
 * few-shot prompting. `eval/tests/contamination.test.ts` asserts the disjointness so
 * the property cannot rot silently.
 */

import { zodToJsonSchema } from '@/lib/llm/json-schema';
import { ParsedResumeSchema } from '@/lib/resume-schema';

const SCHEMA_JSON = JSON.stringify(zodToJsonSchema(ParsedResumeSchema), null, 2);

const BASE_INSTRUCTIONS = `You are an expert resume parser working inside an applicant tracking system.

Extract the candidate's details from the resume document and return a single JSON object.

Rules:
- Copy values verbatim from the document. Do not normalise dates, expand abbreviations, or rewrite job titles.
- If a field is genuinely absent from the document, return an empty string for text fields and an empty array for list fields. Never invent a plausible value.
- Multi-column layouts: read each column top to bottom as a separate flow. Do not interleave lines across columns.
- Keep every distinct role as its own entry in \`experience\`, even when two roles share an employer.
- \`skills\` should contain individual skills, not the whole line they were listed on.

Return only the JSON object. No markdown fences, no commentary.`;

const CONFIDENCE_INSTRUCTIONS = `
Confidence:
- Populate the \`confidence\` object with your honest certainty per field, from 0 to 1.
- A field you read cleanly should score near 1.0. A field you inferred, guessed, or reconstructed from damaged text should score low.
- Uniformly high scores are useless. These numbers are checked against the truth, and a confident wrong answer is worse than an uncertain one.`;

/**
 * Two exemplars, chosen for contrast rather than coverage: one dense two-column
 * senior resume where the failure mode is column interleaving, one sparse
 * single-column new-grad resume where the failure mode is inventing an employment
 * history that is not there. Three or more exemplars pushed the prompt past Groq's
 * per-minute ceiling for multi-page inputs, which is the tradeoff the token budget
 * exists to manage.
 */
const FEW_SHOT_EXEMPLARS: Array<{ document: string; output: unknown }> = [
  {
    document: `MIRIAM OKONKWO-BAILEY
Lisbon, Portugal · miriam.ob@quintaline.pt · +351 912 004 887

PROFESSIONAL EXPERIENCE          CORE COMPETENCIES
Principal Reliability Engineer   Erlang
Quintaline Systems               Chaos engineering
March 2019 - Present             SLO design
Rebuilt the incident review       Kubernetes
process; cut mean time to
recovery from 94 to 31 minutes.  EDUCATION
                                 Licenciatura, Informatics
Reliability Engineer             Universidade do Minho
Vasterbotten Telecom             2011
Aug 2015 - Feb 2019
Owned the paging rotation for
eleven services.`,
    output: {
      personal: {
        name: 'MIRIAM OKONKWO-BAILEY',
        email: 'miriam.ob@quintaline.pt',
        phone: '+351 912 004 887',
        location: 'Lisbon, Portugal',
      },
      skills: ['Erlang', 'Chaos engineering', 'SLO design', 'Kubernetes'],
      experience: [
        {
          title: 'Principal Reliability Engineer',
          company: 'Quintaline Systems',
          duration: 'March 2019 - Present',
          description:
            'Rebuilt the incident review process; cut mean time to recovery from 94 to 31 minutes.',
          confidence: 0.96,
        },
        {
          title: 'Reliability Engineer',
          company: 'Vasterbotten Telecom',
          duration: 'Aug 2015 - Feb 2019',
          description: 'Owned the paging rotation for eleven services.',
          confidence: 0.94,
        },
      ],
      education: [
        {
          degree: 'Licenciatura, Informatics',
          institution: 'Universidade do Minho',
          graduationDate: '2011',
          confidence: 0.9,
        },
      ],
      certifications: [],
      confidence: {
        name: 0.99,
        email: 0.99,
        phone: 0.98,
        location: 0.97,
        skills: 0.93,
        skillConfidences: [0.95, 0.92, 0.9, 0.95],
        experience: 0.95,
        education: 0.88,
        certifications: 0.99,
        overall: 0.94,
      },
    },
  },
  {
    document: `Tobias Marchetti-Oyelaran
tmoyelaran@stonehaven.ac.uk

Education
BSc Bioinformatics, Stonehaven Institute, expected June 2026

Projects
Sequence aligner in Rust; profiled and reduced peak memory 40%.

Technical: Rust, Python, Nextflow`,
    output: {
      personal: {
        name: 'Tobias Marchetti-Oyelaran',
        email: 'tmoyelaran@stonehaven.ac.uk',
        phone: '',
        location: '',
      },
      skills: ['Rust', 'Python', 'Nextflow'],
      experience: [],
      education: [
        {
          degree: 'BSc Bioinformatics',
          institution: 'Stonehaven Institute',
          graduationDate: 'expected June 2026',
          confidence: 0.92,
        },
      ],
      certifications: [],
      confidence: {
        name: 0.98,
        email: 0.99,
        phone: 0.99,
        location: 0.95,
        skills: 0.94,
        skillConfidences: [0.96, 0.96, 0.9],
        experience: 0.9,
        education: 0.92,
        certifications: 0.98,
        overall: 0.94,
      },
    },
  },
];

export interface BuiltPrompt {
  /** Everything except the document itself. Stable across documents, so it is cacheable. */
  system: string;
  /** Characters of fixed scaffolding, fed to the token budget as immovable overhead. */
  overheadChars: number;
}

/**
 * Builds the instruction half of the prompt. The document half is attached by the
 * provider, because that is the part that legitimately differs between a multimodal
 * and a text-only backend.
 */
export function buildSystemPrompt(opts: {
  strategy: 'zero-shot' | 'few-shot';
  requestConfidence: boolean;
  /** Omit the JSON schema when the provider enforces the shape out of band (Genkit does). */
  includeSchema: boolean;
}): BuiltPrompt {
  const parts: string[] = [BASE_INSTRUCTIONS];

  if (opts.requestConfidence) parts.push(CONFIDENCE_INSTRUCTIONS.trim());

  if (opts.includeSchema) {
    parts.push(`The JSON object must conform to this schema:\n${SCHEMA_JSON}`);
  }

  if (opts.strategy === 'few-shot') {
    const rendered = FEW_SHOT_EXEMPLARS.map((ex, i) => {
      const output = opts.requestConfidence
        ? ex.output
        : stripConfidence(ex.output as Record<string, unknown>);
      return `Example ${i + 1}\n--- RESUME ---\n${ex.document}\n--- EXPECTED JSON ---\n${JSON.stringify(output)}`;
    }).join('\n\n');
    parts.push(`Worked examples:\n\n${rendered}`);
  }

  const system = parts.join('\n\n');
  return { system, overheadChars: system.length };
}

/** Exposed so the contamination test can read the exemplars without duplicating them. */
export function fewShotExemplarText(): string {
  return FEW_SHOT_EXEMPLARS.map(
    (e) => `${e.document}\n${JSON.stringify(e.output)}`
  ).join('\n');
}

function stripConfidence(obj: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...obj };
  delete clone.confidence;
  for (const key of ['experience', 'education']) {
    if (Array.isArray(clone[key])) {
      clone[key] = (clone[key] as Array<Record<string, unknown>>).map((entry) => {
        const c = { ...entry };
        delete c.confidence;
        return c;
      });
    }
  }
  return clone;
}
