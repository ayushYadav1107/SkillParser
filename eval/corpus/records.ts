/**
 * @fileOverview Label-first record synthesis.
 *
 * The corpus is built backwards from how a resume dataset is normally assembled.
 * Instead of collecting documents and then annotating them — which is expensive,
 * slow, and produces labels that are themselves noisy — the structured record is
 * generated *first* and the document is rendered *from* it. The label is therefore
 * correct by construction rather than by agreement, there is no annotator
 * disagreement to report because there is no annotation step, and the whole corpus
 * regenerates byte-identically from a seed.
 *
 * What this buys and what it costs
 * --------------------------------
 * Buys: exact labels, zero personal data, a public repository, an arbitrary corpus
 * size, and controlled variation along axes we care about (layout, scan quality,
 * name format, date format, section vocabulary).
 *
 * Costs, stated plainly because they bound every number in the report: generated
 * resumes are cleaner and more internally consistent than real ones. They do not
 * contain the genuinely ambiguous cases — a job title that spans two lines in a
 * way no rule resolves, a table that is really a layout hack, a "2019-2021" that
 * refers to a degree in the middle of an employment section. Scores on this corpus
 * are an **upper bound** on real-world performance, and the README says so in the
 * same paragraph as the headline metric. The intended use is comparative: arm A
 * versus arm B under identical conditions, where the absolute level matters less
 * than the delta and the delta is what the experiment is actually measuring.
 *
 * Adversarial content is included on purpose. Roughly one resume in ten has no
 * education section, one in three has no certifications, some have two roles at the
 * same employer (which invites entry merging), and every resume carries a summary
 * and/or projects section whose text belongs to no label — so a model that
 * paraphrases prose into `experience` is caught as a hallucination rather than
 * rewarded.
 */

import { Rng } from './rng';
import {
  CITIES, COMPANIES, CREATIVE_HEADINGS, DEGREES, DISCIPLINES, EMAIL_DOMAINS,
  FAMILY_NAMES, GIVEN_NAMES, HEADER_DISTRACTORS, HEADINGS, INSTITUTIONS,
  MONTHS, MONTHS_LONG, SOFT_SKILLS,
} from './pools';
import type { GroundTruthResume } from '../../src/lib/resume-schema';

export type DateFormat = 'short-month' | 'long-month' | 'numeric' | 'year-only';
export type NameCase = 'title' | 'upper';
export type HeadingStyle = 'conventional' | 'creative';

/**
 * How the title / company / date block at the top of an entry is arranged.
 *
 * Real resumes use all of these and a parser has to cope with all of them. The
 * `right-aligned-dates` variant is the interesting one: the date sits at the right
 * edge of the *same* line as the title, so the text layer contains
 * `Senior Engineer          Jan 2020 - Present` as one visual row. Naive
 * extraction glues them together, and a rule that looks for "the line containing a
 * date range" finds the title line instead of a separate date line.
 */
export type EntryHeaderStyle =
  | 'title-company-date-stacked'
  | 'company-title-date-stacked'
  | 'title-inline-company'
  | 'company-inline-title'
  | 'right-aligned-dates';

export interface StyleSpec {
  headings: { experience: string; education: string; skills: string; certifications: string; summary: string };
  headingStyle: HeadingStyle;
  entryHeaderStyle: EntryHeaderStyle;
  contactSeparator: string;
  nameCase: NameCase;
  serifBody: boolean;
  bullet: string;
  dateFormat: DateFormat;
  /** Prose that belongs to no label. Present to catch paraphrase-into-field behaviour. */
  summaryText: string | null;
  projects: string[] | null;
  skillsAsBullets: boolean;
  /** Header lines that resemble contact details but are not labelled fields. */
  distractors: string[];
  /** Group skills under inline category labels ("Languages: Go, Rust"). */
  skillCategories: boolean;
}

export interface RecordMeta {
  discipline: string;
  seniority: 'new-grad' | 'mid' | 'senior';
  experienceCount: number;
  skillCount: number;
  hasEducation: boolean;
  hasCertifications: boolean;
  hasPhone: boolean;
  hasLocation: boolean;
  /** Two roles at one employer — the case that invites entry merging. */
  hasRepeatEmployer: boolean;
  dateFormat: DateFormat;
  headingStyle: HeadingStyle;
  entryHeaderStyle: EntryHeaderStyle;
}

export interface ResumeRecord {
  id: string;
  seed: number;
  truth: GroundTruthResume;
  style: StyleSpec;
  meta: RecordMeta;
}

export const CORPUS_SEED = 20260824;
export const CORPUS_SIZE = 60;

export function generateCorpusRecords(size = CORPUS_SIZE, seed = CORPUS_SEED): ResumeRecord[] {
  const records: ResumeRecord[] = [];
  for (let i = 0; i < size; i += 1) {
    // Per-record seeds rather than one shared stream: adding a record at the end
    // must not shift the content of every record before it, or the corpus stops
    // being stable across versions of this file.
    const recordSeed = seed + i * 7919;
    records.push(generateRecord(`r${String(i + 1).padStart(3, '0')}`, recordSeed));
  }
  return records;
}

export function generateRecord(id: string, seed: number): ResumeRecord {
  const rng = new Rng(seed);

  const discipline = rng.pick(DISCIPLINES);
  const seniority: RecordMeta['seniority'] = rng.next() < 0.22 ? 'new-grad' : rng.next() < 0.55 ? 'mid' : 'senior';

  const experienceCount = seniority === 'new-grad' ? rng.int(0, 1) : seniority === 'mid' ? rng.int(2, 3) : rng.int(3, 5);
  const hasEducation = rng.next() > 0.1;
  const hasCertifications = rng.next() > 0.35 && discipline.certifications.length > 0;
  const hasPhone = rng.next() > 0.08;
  const hasLocation = rng.next() > 0.05;
  const nameCase: NameCase = rng.next() < 0.25 ? 'upper' : 'title';
  const dateFormat: DateFormat = rng.pick(['short-month', 'long-month', 'numeric', 'year-only'] as const);

  const given = rng.pick(GIVEN_NAMES);
  const family = rng.pick(FAMILY_NAMES);
  const displayName = nameCase === 'upper' ? `${given} ${family}`.toUpperCase() : `${given} ${family}`;

  const email = makeEmail(rng, given, family);
  const phone = hasPhone ? makePhone(rng) : '';
  const location = hasLocation ? rng.pick(CITIES) : '';

  const skillCount = rng.int(6, 12);
  const technical = rng.sample(discipline.skills, Math.min(skillCount, discipline.skills.length));
  const soft = rng.next() < 0.5 ? rng.sample(SOFT_SKILLS, rng.int(1, 2)) : [];
  const skills = [...technical, ...soft];

  const experience = buildExperience(rng, discipline, experienceCount, dateFormat, seniority);
  const hasRepeatEmployer = new Set(experience.map((e) => e.company)).size < experience.length;

  const education = hasEducation ? buildEducation(rng, seniority, dateFormat) : [];
  const certifications = hasCertifications
    ? rng.sample(discipline.certifications, rng.int(1, Math.min(2, discipline.certifications.length)))
    : [];

  // A third of the corpus uses unconventional section headings. See the note on
  // CREATIVE_HEADINGS: this is the axis that keeps the rule-based baseline from
  // saturating, and it is realistic rather than adversarial.
  const headingStyle: HeadingStyle = rng.next() < 0.33 ? 'creative' : 'conventional';
  const headingPool = headingStyle === 'creative' ? CREATIVE_HEADINGS : HEADINGS;

  const entryHeaderStyle: EntryHeaderStyle = rng.pick([
    'title-company-date-stacked',
    'title-company-date-stacked',
    'company-title-date-stacked',
    'title-inline-company',
    'company-inline-title',
    'right-aligned-dates',
    'right-aligned-dates',
  ] as const);

  const slug = `${asciify(given).toLowerCase()}${asciify(family).toLowerCase().slice(0, 6)}`;

  const style: StyleSpec = {
    headings: {
      experience: rng.pick(headingPool.experience),
      education: rng.pick(headingPool.education),
      skills: rng.pick(headingPool.skills),
      certifications: rng.pick(headingPool.certifications),
      summary: rng.pick(headingPool.summary),
    },
    headingStyle,
    entryHeaderStyle,
    contactSeparator: rng.pick([' | ', ' · ', '  •  ', ' — ']),
    nameCase,
    serifBody: rng.next() < 0.3,
    bullet: rng.pick(['•', '–', '‣', '-']),
    dateFormat,
    summaryText: rng.next() < 0.55 ? makeSummary(rng, discipline.name, seniority) : null,
    projects: rng.next() < 0.3 ? makeProjects(rng, discipline.name) : null,
    skillsAsBullets: rng.next() < 0.35,
    distractors:
      rng.next() < 0.45
        ? rng.sample(HEADER_DISTRACTORS, rng.int(1, 2)).map((d) => d.replace('{slug}', slug))
        : [],
    skillCategories: rng.next() < 0.3,
  };

  return {
    id,
    seed,
    truth: {
      personal: { name: displayName, email, phone, location },
      skills,
      experience,
      education,
      certifications,
    },
    style,
    meta: {
      discipline: discipline.name,
      seniority,
      experienceCount: experience.length,
      skillCount: skills.length,
      hasEducation,
      hasCertifications,
      hasPhone,
      hasLocation,
      hasRepeatEmployer,
      dateFormat,
      headingStyle,
      entryHeaderStyle,
    },
  };
}

// ---------------------------------------------------------------------------

function makeEmail(rng: Rng, given: string, family: string): string {
  const g = asciify(given).toLowerCase();
  const f = asciify(family).toLowerCase().replace(/[^a-z]/g, '');
  const domain = rng.pick(EMAIL_DOMAINS);
  const local = rng.pick([
    `${g}.${f}`,
    `${g[0]}${f}`,
    `${g}${f[0]}`,
    `${g}_${f}`,
    `${g}.${f}${rng.int(10, 99)}`,
  ]);
  return `${local}@${domain}`;
}

function makePhone(rng: Rng): string {
  const style = rng.int(0, 4);
  const d = (n: number) => Array.from({ length: n }, () => rng.int(0, 9)).join('');
  switch (style) {
    case 0: return `+91 ${rng.int(70, 99)}${d(3)} ${d(5)}`;
    case 1: return `+1 (${rng.int(200, 989)}) ${d(3)}-${d(4)}`;
    case 2: return `${rng.int(200, 989)}-${d(3)}-${d(4)}`;
    case 3: return `+44 ${d(4)} ${d(6)}`;
    default: return `+${rng.int(30, 99)} ${d(3)} ${d(3)} ${d(3)}`;
  }
}

function formatMonthYear(rng: Rng, month: number, year: number, format: DateFormat): string {
  switch (format) {
    case 'short-month': return `${MONTHS[month]} ${year}`;
    case 'long-month': return `${MONTHS_LONG[month]} ${year}`;
    case 'numeric': return `${String(month + 1).padStart(2, '0')}/${year}`;
    case 'year-only': return `${year}`;
  }
}

function buildExperience(
  rng: Rng,
  discipline: (typeof DISCIPLINES)[number],
  count: number,
  format: DateFormat,
  seniority: RecordMeta['seniority']
): GroundTruthResume['experience'] {
  if (count === 0) return [];

  const dash = rng.pick([' - ', ' – ', ' — ', '-']);
  const entries: GroundTruthResume['experience'] = [];

  // Walk backwards from the present so the history is chronologically coherent.
  let endYear = 2026;
  let endMonth = rng.int(0, 7);
  const titles = rng.shuffle(discipline.titles);
  // One resume in five gets two consecutive roles at one employer: the promotion
  // pattern, and the single most reliable way to induce entry merging.
  const repeatEmployerAt = count >= 2 && rng.next() < 0.2 ? rng.int(0, count - 2) : -1;
  let repeatedCompany = '';

  for (let i = 0; i < count; i += 1) {
    const spanMonths = seniority === 'senior' ? rng.int(14, 44) : rng.int(9, 30);
    const startTotal = endYear * 12 + endMonth - spanMonths;
    const startYear = Math.floor(startTotal / 12);
    const startMonth = ((startTotal % 12) + 12) % 12;

    const isPresent = i === 0 && rng.next() < 0.55;
    const start = formatMonthYear(rng, startMonth, startYear, format);
    const end = isPresent
      ? rng.pick(['Present', 'present', 'Current'])
      : formatMonthYear(rng, endMonth, endYear, format);

    let company: string;
    if (i === repeatEmployerAt + 1 && repeatedCompany) {
      company = repeatedCompany;
    } else {
      company = rng.pick(COMPANIES);
      if (i === repeatEmployerAt) repeatedCompany = company;
    }

    const bulletCount = seniority === 'new-grad' ? 1 : rng.int(1, 3);
    const description = rng.sample(discipline.achievements, bulletCount).join(' ');

    entries.push({
      title: titles[i % titles.length],
      company,
      duration: `${start}${dash}${end}`,
      description,
    });

    endYear = startYear;
    endMonth = startMonth;
    // A gap of a few months between roles, sometimes.
    if (rng.next() < 0.3) {
      const gap = rng.int(1, 4);
      const t = endYear * 12 + endMonth - gap;
      endYear = Math.floor(t / 12);
      endMonth = ((t % 12) + 12) % 12;
    }
  }

  return entries;
}

function buildEducation(
  rng: Rng,
  seniority: RecordMeta['seniority'],
  format: DateFormat
): GroundTruthResume['education'] {
  const count = seniority === 'senior' && rng.next() < 0.35 ? 2 : 1;
  const out: GroundTruthResume['education'] = [];
  let year = seniority === 'new-grad' ? rng.int(2026, 2028) : rng.int(2012, 2023);

  for (let i = 0; i < count; i += 1) {
    const month = rng.int(3, 7);
    const future = year > 2026;
    const base = format === 'year-only' ? `${year}` : formatMonthYear(rng, month, year, format);
    out.push({
      degree: rng.pick(DEGREES),
      institution: rng.pick(INSTITUTIONS),
      graduationDate: future ? `Expected ${base}` : base,
    });
    year -= rng.int(2, 5);
  }
  return out;
}

function makeSummary(rng: Rng, discipline: string, seniority: RecordMeta['seniority']): string {
  const years = seniority === 'new-grad' ? 'Early-career' : seniority === 'mid' ? 'Four years of' : 'Nine years of';
  return (
    `${years} ${discipline} work with a bias toward measurable outcomes. ` +
    rng.pick([
      'Comfortable owning a system end to end, from design review through on-call.',
      'Happiest on problems where the requirements are still being argued about.',
      'Writes things down; prefers a short design doc to a long meeting.',
      'Has shipped to production continuously and has the incident reviews to prove it.',
    ])
  );
}

function makeProjects(rng: Rng, discipline: string): string[] {
  const pool = [
    'Open-source contributor: three merged patches to a widely used HTTP client.',
    'Built a static-site generator used by ~400 people; still maintained.',
    `Weekend project: a ${discipline} benchmark suite with reproducible run scripts.`,
    'Wrote a from-scratch key-value store to understand write-ahead logging properly.',
  ];
  return rng.sample(pool, rng.int(1, 2));
}

/** Strips diacritics so a generated email address stays a legal address. */
function asciify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
}

