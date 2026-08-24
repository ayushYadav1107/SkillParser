/**
 * @fileOverview Single source of truth for the shape of a parsed resume.
 *
 * Everything downstream — the Genkit flow, every `LLMProvider` implementation, the
 * evaluation harness, and the UI — imports these schemas. Nothing re-declares them.
 *
 * Compatibility contract
 * ----------------------
 * The four original top-level fields (`skills`, `experience`, `education`,
 * `certifications`) are unchanged, so existing UI code keeps working. Two additive
 * groups were introduced for the evaluation work:
 *
 *   - `personal`  — name / email / phone / location. These are the fields with an
 *                   unambiguous correct answer, which makes them the only ones that
 *                   can be scored by exact match. Without them the evaluation would
 *                   be entirely fuzzy, which is a much weaker claim.
 *   - `confidence`— the model's self-reported certainty per field. Used only by the
 *                   calibration analysis; the product ignores it. Optional on
 *                   purpose: a provider that declines to emit confidence is recorded
 *                   as "unreported" and excluded from the calibration denominator
 *                   rather than being silently scored as 0.0.
 */

import { z } from 'zod';

/** A probability in [0, 1]. Coerced because models frequently emit "0.9" as a string. */
const Probability = z.coerce.number().min(0).max(1);

export const PersonalInfoSchema = z.object({
  name: z
    .string()
    .describe("The candidate's full name exactly as written at the top of the resume."),
  email: z
    .string()
    .describe('Primary email address. Empty string if the resume does not contain one.'),
  phone: z
    .string()
    .describe('Primary phone number, copied verbatim including any country code.'),
  location: z
    .string()
    .describe("City / state / country line, e.g. 'Bengaluru, India'. Empty string if absent."),
});
export type PersonalInfo = z.infer<typeof PersonalInfoSchema>;

export const ExperienceEntrySchema = z.object({
  title: z.string().describe('Job title or role.'),
  company: z.string().describe('Name of the company or organization.'),
  duration: z
    .string()
    .describe("Duration of employment (e.g., 'Jan 2020 - Dec 2022'). Copy the resume's wording."),
  description: z
    .string()
    .describe('Key responsibilities and achievements in bullet points or a short paragraph.'),
  confidence: Probability.optional().describe(
    'Your certainty from 0 to 1 that this entire entry was read correctly.'
  ),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const EducationEntrySchema = z.object({
  degree: z.string().describe('Degree or qualification obtained.'),
  institution: z.string().describe('Name of the educational institution.'),
  graduationDate: z.string().describe("Date of graduation or completion (e.g., 'May 2022')."),
  confidence: Probability.optional().describe(
    'Your certainty from 0 to 1 that this entire entry was read correctly.'
  ),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

/**
 * Self-reported certainty, one score per field group.
 *
 * `skillConfidences` is deliberately a parallel array rather than turning `skills`
 * into objects: it keeps the product-facing `skills: string[]` shape intact while
 * still giving the calibration analysis one datapoint per skill instead of one per
 * resume. Entries beyond `skills.length` are ignored; missing entries are treated
 * as unreported.
 */
export const ExtractionConfidenceSchema = z.object({
  name: Probability.optional(),
  email: Probability.optional(),
  phone: Probability.optional(),
  location: Probability.optional(),
  skills: Probability.optional().describe('Overall certainty in the skills list.'),
  skillConfidences: z
    .array(Probability)
    .optional()
    .describe('One certainty score per entry of `skills`, in the same order.'),
  experience: Probability.optional().describe('Overall certainty in the experience section.'),
  education: Probability.optional().describe('Overall certainty in the education section.'),
  certifications: Probability.optional().describe('Overall certainty in the certifications list.'),
  overall: Probability.optional().describe('Overall certainty in the whole extraction.'),
});
export type ExtractionConfidence = z.infer<typeof ExtractionConfidenceSchema>;

export const ParsedResumeSchema = z.object({
  personal: PersonalInfoSchema.describe('Contact and identity details.'),
  skills: z.array(z.string()).describe('A list of technical and soft skills.'),
  experience: z.array(ExperienceEntrySchema).describe('A list of work experiences.'),
  education: z.array(EducationEntrySchema).describe('A list of educational background entries.'),
  certifications: z.array(z.string()).describe('A list of professional certifications.'),
  confidence: ExtractionConfidenceSchema.optional().describe(
    'Your self-reported certainty per field. Be honest: low scores on fields you had to guess are more useful than uniformly high scores.'
  ),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

/**
 * The ground-truth label for one synthetic resume. Identical in shape to
 * `ParsedResume` minus the confidence machinery — labels are certain by
 * construction, which is the whole point of generating the corpus label-first.
 */
export const GroundTruthResumeSchema = z.object({
  personal: PersonalInfoSchema,
  skills: z.array(z.string()),
  experience: z.array(ExperienceEntrySchema.omit({ confidence: true })),
  education: z.array(EducationEntrySchema.omit({ confidence: true })),
  certifications: z.array(z.string()),
});
export type GroundTruthResume = z.infer<typeof GroundTruthResumeSchema>;

/** Empty-but-valid parse. Used when a provider returns nothing usable. */
export function emptyParsedResume(): ParsedResume {
  return {
    personal: { name: '', email: '', phone: '', location: '' },
    skills: [],
    experience: [],
    education: [],
    certifications: [],
  };
}

/**
 * Accepts whatever a model produced and coerces it into a valid `ParsedResume`.
 *
 * Models drop fields, return `null` for absent values, and occasionally return a
 * bare string where an object was requested. Failing the whole extraction over that
 * would conflate "the model cannot follow a schema" with "the model cannot read a
 * resume" — two different failure modes that the error taxonomy needs to keep apart.
 * So we repair what is repairable and let the metrics score the result.
 */
export function coerceParsedResume(raw: unknown): { value: ParsedResume; repaired: string[] } {
  const repaired: string[] = [];
  const strict = ParsedResumeSchema.safeParse(raw);
  if (strict.success) return { value: strict.data, repaired };

  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter((s) => s.trim().length > 0) : [];

  const personalRaw = (obj.personal ?? obj.contact ?? obj.personalInfo ?? {}) as Record<string, unknown>;
  if (!obj.personal) repaired.push('personal:absent');

  const experience = Array.isArray(obj.experience)
    ? obj.experience.map((e) => {
        const r = (e ?? {}) as Record<string, unknown>;
        return {
          title: str(r.title ?? r.role ?? r.position),
          company: str(r.company ?? r.organization ?? r.employer),
          duration: str(r.duration ?? r.dates ?? r.period),
          description: str(r.description ?? r.summary ?? r.details),
          confidence: typeof r.confidence === 'number' ? clamp01(r.confidence) : undefined,
        };
      })
    : [];
  if (obj.experience && !Array.isArray(obj.experience)) repaired.push('experience:not-array');

  const education = Array.isArray(obj.education)
    ? obj.education.map((e) => {
        const r = (e ?? {}) as Record<string, unknown>;
        return {
          degree: str(r.degree ?? r.qualification),
          institution: str(r.institution ?? r.school ?? r.university),
          graduationDate: str(r.graduationDate ?? r.date ?? r.year),
          confidence: typeof r.confidence === 'number' ? clamp01(r.confidence) : undefined,
        };
      })
    : [];
  if (obj.education && !Array.isArray(obj.education)) repaired.push('education:not-array');

  const confidenceParsed = ExtractionConfidenceSchema.safeParse(obj.confidence ?? {});

  return {
    value: {
      personal: {
        name: str(personalRaw.name ?? obj.name),
        email: str(personalRaw.email ?? obj.email),
        phone: str(personalRaw.phone ?? obj.phone),
        location: str(personalRaw.location ?? obj.location ?? personalRaw.address),
      },
      skills: strArray(obj.skills),
      experience,
      education,
      certifications: strArray(obj.certifications),
      confidence: confidenceParsed.success ? confidenceParsed.data : undefined,
    },
    repaired,
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
