/**
 * @fileOverview A rule-based resume parser. No model, no network, no cost.
 *
 * This is not a mock. It is the baseline arm of the experiment.
 *
 * An LLM extractor that reports 0.9 F1 has said nothing until you know what a
 * hundred lines of regex scores on the same documents. If the gap is small, the
 * model is not earning its latency and its bill; if the gap is large, the number is
 * evidence. Every accuracy claim in the eval report is quoted against this baseline
 * for that reason, and because it runs offline it also lets the entire harness —
 * metrics, alignment, error taxonomy, calibration, reporting — be exercised end to
 * end in CI without an API key.
 *
 * It emits genuine confidence scores rather than constants: a field recovered by a
 * strict regex (an email) reports high certainty, one recovered by a positional
 * guess (a name assumed to be on the first line) reports low. That gives the
 * calibration analysis real signal to work with even on the offline path.
 *
 * Honest caveat, repeated in the eval README: this baseline and the corpus
 * generator share an author. It was written against general resume conventions
 * rather than against the generator's templates, but a shared-author baseline is
 * still an optimistic estimate of what rule-based parsing achieves on resumes in
 * the wild. Read it as a floor for the LLM arms to clear, not as a published SOTA.
 */

import { extractDocumentText } from '@/lib/llm/document';
import type {
  LLMProvider,
  ParseOptions,
  PricingInfo,
  ProviderResult,
  ResumeDocument,
} from '@/lib/llm/types';
import type { EducationEntry, ExperienceEntry, ParsedResume } from '@/lib/resume-schema';

const PRICING: PricingInfo = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  currency: 'USD',
  checkedOn: '2026-08-24',
  source: 'Runs locally; the only cost is CPU time.',
};

const SECTION_PATTERNS: Array<{ key: SectionKey; re: RegExp }> = [
  { key: 'experience', re: /^(work\s+|professional\s+|relevant\s+)?experience$|^employment(\s+history)?$|^career\s+history$/i },
  { key: 'education', re: /^education(\s+(and|&)\s+training)?$|^academic\s+background$/i },
  { key: 'skills', re: /^(technical\s+|core\s+|key\s+)?(skills|competencies)$|^technologies$|^technical$/i },
  { key: 'certifications', re: /^certifications?$|^licen[cs]es?(\s+(and|&)\s+certifications?)?$|^credentials$/i },
  { key: 'projects', re: /^(selected\s+|personal\s+)?projects$/i },
  { key: 'summary', re: /^(professional\s+)?summary$|^objective$|^profile$|^about$/i },
];

type SectionKey =
  | 'experience'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'projects'
  | 'summary'
  | 'header';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/;
const MONTH =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_RANGE_RE = new RegExp(
  `((?:${MONTH}\\.?\\s+)?\\d{4}|\\d{1,2}/\\d{4}|${MONTH}\\.?\\s*\\d{4})\\s*(?:-|–|—|to)\\s*` +
    `((?:${MONTH}\\.?\\s+)?\\d{4}|\\d{1,2}/\\d{4}|present|current|now)`,
  'i'
);
const SINGLE_DATE_RE = new RegExp(`(?:expected\\s+)?(?:${MONTH}\\.?\\s+)?(19|20)\\d{2}`, 'i');
const DEGREE_RE =
  /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|bachelor|m\.?\s?tech|m\.?\s?sc|master|mba|ph\.?\s?d|doctorate|associate|diploma|licenciatura)\b/i;

export class HeuristicProvider implements LLMProvider {
  readonly id = 'heuristic';
  readonly displayName = 'Rule-based baseline (regex + section segmentation)';
  readonly defaultModel = 'rules-v1';
  readonly supportsNativeDocuments = false;
  readonly pricing = PRICING;

  isConfigured(): boolean {
    return true;
  }

  async parse(document: ResumeDocument, options: ParseOptions): Promise<ProviderResult> {
    const pre = await extractDocumentText(document, {
      pdfStrategy: options.pdfStrategy ?? 'column-aware',
    });
    const started = Date.now();
    const parsed = parseResumeText(pre.text, options.requestConfidence !== false);
    const latencyMs = Date.now() - started;

    return {
      parsed,
      providerId: this.id,
      // The prompt strategy is meaningless for a rule-based parser. Recording it in
      // the model id keeps the arm labelling honest instead of implying the
      // baseline responded to prompting.
      modelId: `${this.defaultModel} · ${options.pdfStrategy ?? 'column-aware'} (prompt strategy not applicable)`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: true },
      latencyMs,
      preprocessing: {
        path: pre.path,
        extractedChars: pre.text.length,
        sentChars: pre.text.length,
        truncated: false,
        latencyMs: pre.latencyMs,
      },
      repairs: [],
      attempts: 1,
      failoverTrail: [],
      rawResponse: undefined,
    };
  }
}

/** Exported so the offline tests can drive the parser without constructing a document. */
export function parseResumeText(text: string, withConfidence: boolean): ParsedResume {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === ''));

  const sections = segment(lines);
  const header = sections.get('header') ?? [];
  const headerText = header.join('\n');

  const email = headerText.match(EMAIL_RE)?.[0] ?? text.match(EMAIL_RE)?.[0] ?? '';
  const phone = extractPhone(headerText) ?? extractPhone(text) ?? '';
  const { name, nameConfidence } = extractName(header);
  const { location, locationConfidence } = extractLocation(header);

  const skillLines = sections.get('skills') ?? [];
  const skills = splitSkills(skillLines);

  const certLines = sections.get('certifications') ?? [];
  const certifications = certLines
    .map((l) => l.replace(/^[-•*·]\s*/, '').trim())
    .filter((l) => l.length > 2);

  const experience = parseExperience(sections.get('experience') ?? []);
  const education = parseEducation(sections.get('education') ?? []);

  const result: ParsedResume = {
    personal: { name, email, phone, location },
    skills,
    experience: experience.map(({ confidence, ...e }) => (withConfidence ? { ...e, confidence } : e)),
    education: education.map(({ confidence, ...e }) => (withConfidence ? { ...e, confidence } : e)),
    certifications,
  };

  if (withConfidence) {
    const experienceConfidence = mean(experience.map((e) => e.confidence)) ?? (experience.length ? 0.5 : 0.3);
    const educationConfidence = mean(education.map((e) => e.confidence)) ?? (education.length ? 0.5 : 0.3);
    result.confidence = {
      name: nameConfidence,
      // A strict regex either matched or it did not; there is no middle ground to
      // report, and pretending otherwise would fabricate calibration signal.
      email: email ? 0.98 : 0.08,
      phone: phone ? (/^\+/.test(phone) ? 0.94 : 0.82) : 0.08,
      location: locationConfidence,
      skills: skillLines.length ? 0.88 : 0.25,
      skillConfidences: skills.map(() => (skillLines.length ? 0.88 : 0.25)),
      experience: experienceConfidence,
      education: educationConfidence,
      certifications: certLines.length ? 0.9 : 0.35,
      overall:
        mean([
          name ? nameConfidence : 0.1,
          email ? 0.98 : 0.08,
          experienceConfidence,
          educationConfidence,
          skillLines.length ? 0.88 : 0.25,
        ]) ?? 0.5,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------

function segment(lines: string[]): Map<SectionKey, string[]> {
  const out = new Map<SectionKey, string[]>();
  let current: SectionKey = 'header';
  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      current = heading;
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    if (!out.has(current)) out.set(current, []);
    out.get(current)!.push(line);
  }
  return out;
}

/**
 * A heading is short, has no terminal punctuation, and matches a known section
 * name. The length guard matters: a bullet reading "Led the education platform
 * rewrite" contains the word "education" and would otherwise reset the parser
 * mid-section.
 */
function matchHeading(line: string): SectionKey | null {
  const trimmed = line.trim().replace(/[:•\-–—]+$/, '').trim();
  if (trimmed.length === 0 || trimmed.length > 34) return null;
  if (/[.;,]$/.test(trimmed)) return null;
  for (const { key, re } of SECTION_PATTERNS) if (re.test(trimmed)) return key;
  return null;
}

function extractPhone(text: string): string | null {
  // Strip emails first: the digits inside an address like `a.b2024@x.com` match the
  // loose phone pattern and win by appearing earlier in the line.
  const cleaned = text.replace(new RegExp(EMAIL_RE.source, 'g'), ' ');
  for (const line of cleaned.split('\n')) {
    for (const chunk of line.split(/[|·•]/)) {
      const m = chunk.match(PHONE_RE);
      if (!m) continue;
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15) return m[0].trim();
    }
  }
  return null;
}

function extractName(header: string[]): { name: string; nameConfidence: number } {
  for (const line of header.slice(0, 4)) {
    const t = line.trim();
    if (!t || EMAIL_RE.test(t) || /\d/.test(t)) continue;
    const words = t.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    const capitalised = words.filter((w) => /^[\p{Lu}]/u.test(w) || /^[\p{Lu}\p{Pd}'.]+$/u.test(w));
    if (capitalised.length < words.length - 1) continue;
    // ALL CAPS names are a common resume convention and read as confidently as
    // title case; a mixed-case line that is neither is more likely a tagline.
    const shouty = t === t.toUpperCase();
    const titled = words.every((w) => /^[\p{Lu}]/u.test(w));
    return { name: t, nameConfidence: shouty || titled ? 0.87 : 0.55 };
  }
  const fallback = header.find((l) => l.trim().length > 0)?.trim() ?? '';
  return { name: fallback, nameConfidence: fallback ? 0.3 : 0.05 };
}

function extractLocation(header: string[]): { location: string; locationConfidence: number } {
  const CITY_RE = /([\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*,\s*[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)*)/u;
  for (const line of header) {
    for (const chunk of line.split(/[|·•]/)) {
      const t = chunk.trim();
      if (!t || EMAIL_RE.test(t)) continue;
      if (/\d{3}/.test(t)) continue; // phone numbers
      const m = t.match(CITY_RE);
      if (m && m[1].length <= 48) return { location: m[1], locationConfidence: 0.78 };
    }
  }
  return { location: '', locationConfidence: 0.2 };
}

function splitSkills(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    // Drop a leading category label ("Languages: Python, Go") but keep the values.
    const line = raw.replace(/^[-•*·]\s*/, '').replace(/^[\p{L} /&]{3,24}:\s*/u, '');
    for (const part of line.split(/[,;|·•]|\s{3,}/)) {
      const s = part.trim().replace(/\.$/, '');
      if (s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s)) out.push(s);
    }
  }
  return dedupe(out);
}

function parseExperience(lines: string[]): Array<ExperienceEntry & { confidence: number }> {
  const blocks = splitEntryBlocks(lines);
  const entries: Array<ExperienceEntry & { confidence: number }> = [];

  for (const block of blocks) {
    const dateLineIndex = block.findIndex((l) => DATE_RANGE_RE.test(l));
    const duration = dateLineIndex >= 0 ? block[dateLineIndex].match(DATE_RANGE_RE)![0].trim() : '';

    const headerLines = block
      .slice(0, Math.max(dateLineIndex, 0) + 1)
      .map((l) => l.replace(DATE_RANGE_RE, '').replace(/[|·•,\s]+$/, '').trim())
      .filter((l) => l.length > 0);

    let title = '';
    let company = '';
    if (headerLines.length >= 2) {
      [title, company] = headerLines;
    } else if (headerLines.length === 1) {
      // "Senior Engineer, Acme Corp" or "Senior Engineer at Acme Corp"
      const split = headerLines[0].split(/\s+(?:at|@)\s+|\s*[,|–—]\s*/);
      title = split[0]?.trim() ?? '';
      company = split.slice(1).join(', ').trim();
    }

    const bodyStart = Math.max(dateLineIndex, headerLines.length - 1) + 1;
    const description = block
      .slice(bodyStart)
      .map((l) => l.replace(/^[-•*·]\s*/, '').trim())
      .filter((l) => l.length > 0)
      .join(' ');

    if (!title && !company && !description) continue;

    // Confidence tracks how much of the entry was actually anchored by a rule
    // rather than assumed by position.
    let confidence = 0.35;
    if (duration) confidence += 0.3;
    if (title && company) confidence += 0.2;
    if (description) confidence += 0.1;
    entries.push({
      title,
      company,
      duration,
      description,
      confidence: Math.min(0.95, confidence),
    });
  }
  return entries;
}

function parseEducation(lines: string[]): Array<EducationEntry & { confidence: number }> {
  const blocks = splitEntryBlocks(lines);
  const entries: Array<EducationEntry & { confidence: number }> = [];

  for (const block of blocks) {
    const joined = block.join(' | ');
    const degreeLine = block.find((l) => DEGREE_RE.test(l)) ?? block[0] ?? '';
    const dateMatch = joined.match(DATE_RANGE_RE) ?? joined.match(SINGLE_DATE_RE);
    const graduationDate = dateMatch ? dateMatch[0].trim() : '';

    const cleaned = block
      .map((l) => l.replace(DATE_RANGE_RE, '').replace(SINGLE_DATE_RE, '').replace(/[|,\s]+$/, '').trim())
      .filter((l) => l.length > 0);

    let degree = '';
    let institution = '';
    const degreeIdx = cleaned.findIndex((l) => DEGREE_RE.test(l));
    if (degreeIdx >= 0) {
      const parts = cleaned[degreeIdx].split(/\s*[,|–—]\s*/);
      degree = parts[0].trim();
      institution = parts.slice(1).join(', ').trim() || cleaned[degreeIdx + 1]?.trim() || '';
    } else if (cleaned.length >= 2) {
      [degree, institution] = cleaned;
    } else {
      degree = degreeLine.trim();
    }

    if (!degree && !institution) continue;

    let confidence = 0.35;
    if (DEGREE_RE.test(degree)) confidence += 0.3;
    if (institution) confidence += 0.15;
    if (graduationDate) confidence += 0.15;
    entries.push({ degree, institution, graduationDate, confidence: Math.min(0.95, confidence) });
  }
  return entries;
}

/**
 * Splits a section body into per-entry blocks.
 *
 * Blank lines are the primary signal. When a section has none — common after OCR,
 * which frequently collapses vertical whitespace — fall back to starting a new
 * block at every line carrying a date range, since in a resume that is almost
 * always the top of an entry.
 */
function splitEntryBlocks(lines: string[]): string[][] {
  const trimmed = lines.map((l) => l.trim());
  const hasBlanks = trimmed.some((l) => l.length === 0);

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of trimmed) {
    if (hasBlanks) {
      if (line.length === 0) {
        if (current.length) blocks.push(current);
        current = [];
        continue;
      }
    } else if (DATE_RANGE_RE.test(line) && current.length > 1) {
      blocks.push(current);
      current = [];
    }
    if (line.length) current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
