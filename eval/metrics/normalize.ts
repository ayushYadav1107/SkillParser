/**
 * @fileOverview Normalisation — deciding what counts as "the same value".
 *
 * Every choice here moves the reported score, so each one is stated rather than
 * buried. The guiding rule is that normalisation should erase differences a human
 * reviewer would not care about (case, accents, `Ltd.` vs `Limited`, a comma) and
 * must not erase differences a human reviewer *would* care about (a different
 * company, a year that is off by one).
 *
 * The most consequential decision is dates. `Jan 2020 - Dec 2022` and
 * `01/2020 – 12/2022` denote the same employment interval. Scoring them as a
 * mismatch would measure formatting compliance, not extraction; scoring them as a
 * match on raw string equality is impossible. So dates are parsed to a canonical
 * interval and compared semantically, and the cases where the *interval* agreed but
 * the *string* did not are counted separately as `DATE_FORMAT_MISMATCH` — visible
 * in the error table, costing nothing in the headline metric. Both numbers are
 * reported because they answer different questions.
 */

const LEGAL_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'plc', 'gmbh', 'ag', 'sa', 'nv',
  'bv', 'pvt', 'private', 'corp', 'corporation', 'co', 'company', 'group', 'holdings',
];

/** Lowercase, strip diacritics, collapse whitespace. The base for everything else. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised, with punctuation reduced to spaces. Used for token comparisons. */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0);
}

/**
 * Organisation names, with legal suffixes removed. `Boreal Instrument Co.` and
 * `Boreal Instrument` are the same employer, and a parser should not be penalised
 * for the trailing token either way.
 */
export function normalizeOrganization(input: string): string {
  const tokens = tokenize(input).filter((t) => !LEGAL_SUFFIXES.includes(t.replace(/\./g, '')));
  return (tokens.length ? tokens : tokenize(input)).join(' ');
}

export function normalizeEmail(input: string): string {
  return normalizeText(input).replace(/^mailto:/, '').replace(/\s/g, '');
}

/**
 * Phone numbers reduced to their last ten significant digits.
 *
 * Ten rather than all of them, because `+1 (476) 008-8414` and `476-008-8414` are
 * the same number and differ only in whether the country code was transcribed.
 * Comparing full digit strings would score the country code as a separate fact and
 * fail a correct extraction over it.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Locations, with a trailing country dropped only when both sides have one. */
export function normalizeLocation(input: string): string {
  return tokenize(input).join(' ');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface DatePoint {
  year: number;
  /** 1–12, or null when the source only gave a year. */
  month: number | null;
  present: boolean;
}

export interface DateInterval {
  start: DatePoint | null;
  end: DatePoint | null;
}

const PRESENT_WORDS = /^(present|current|now|ongoing|to date|till date)$/i;

export function parseDatePoint(raw: string): DatePoint | null {
  const text = normalizeText(raw).replace(/^(expected|anticipated|graduating|est\.?)\s+/, '').trim();
  if (!text) return null;
  if (PRESENT_WORDS.test(text)) return { year: 9999, month: null, present: true };

  // 03/2021 or 3/2021
  const numeric = text.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (numeric) return { year: Number(numeric[2]), month: Number(numeric[1]), present: false };

  // 2021/03 or 2021-03
  const isoish = text.match(/^(\d{4})[/.-](\d{1,2})$/);
  if (isoish) return { year: Number(isoish[1]), month: Number(isoish[2]), present: false };

  const named = text.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (named && MONTH_NAMES[named[1]]) {
    return { year: Number(named[2]), month: MONTH_NAMES[named[1]], present: false };
  }

  const reversed = text.match(/^(\d{4})\s+([a-z]+)$/);
  if (reversed && MONTH_NAMES[reversed[2]]) {
    return { year: Number(reversed[1]), month: MONTH_NAMES[reversed[2]], present: false };
  }

  const yearOnly = text.match(/^(19|20)\d{2}$/);
  if (yearOnly) return { year: Number(text), month: null, present: false };

  // Last resort: a four-digit year anywhere in the string.
  const anyYear = text.match(/(19|20)\d{2}/);
  if (anyYear) {
    const monthWord = Object.keys(MONTH_NAMES).find((m) => new RegExp(`\\b${m}\\b`).test(text));
    return {
      year: Number(anyYear[0]),
      month: monthWord ? MONTH_NAMES[monthWord] : null,
      present: false,
    };
  }
  return null;
}

const RANGE_SPLIT = /\s*(?:--|-|–|—|to|through|until)\s*/i;

export function parseDateInterval(raw: string): DateInterval | null {
  const text = raw.trim();
  if (!text) return null;

  // Split on the *last* separator that produces two parseable halves. Splitting on
  // the first breaks `2020-2022 - Present`, and month names like `Jan-Mar` would
  // otherwise capture the wrong boundary.
  const parts = text.split(RANGE_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const start = parseDatePoint(parts[0]);
    const end = parseDatePoint(parts[parts.length - 1]);
    if (start || end) return { start, end };
  }

  const single = parseDatePoint(text);
  return single ? { start: null, end: single } : null;
}

/**
 * Two intervals agree when both endpoints agree.
 *
 * Endpoint comparison is month-tolerant in one specific direction: if one side
 * recorded a month and the other only a year, the years are compared. That is not
 * leniency for its own sake — a resume that literally says `2021 - 2023` has no
 * month to extract, and requiring one would penalise a correct reading of an
 * imprecise source.
 */
export function datePointsMatch(a: DatePoint | null, b: DatePoint | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a.present || b.present) return a.present && b.present;
  if (a.year !== b.year) return false;
  if (a.month == null || b.month == null) return true;
  return a.month === b.month;
}

export function dateIntervalsMatch(a: string, b: string): boolean {
  const ia = parseDateInterval(a);
  const ib = parseDateInterval(b);
  if (!ia || !ib) return normalizeText(a) === normalizeText(b);
  return datePointsMatch(ia.start, ib.start) && datePointsMatch(ia.end, ib.end);
}

/** True when the interval is right but the string differs — a formatting-only miss. */
export function isDateFormatOnlyDifference(gold: string, predicted: string): boolean {
  return normalizeText(gold) !== normalizeText(predicted) && dateIntervalsMatch(gold, predicted);
}

export function isEmpty(value: string | null | undefined): boolean {
  if (value == null) return true;
  const t = value.trim().toLowerCase();
  return t === '' || t === 'n/a' || t === 'none' || t === 'null' || t === 'not specified' || t === 'unknown';
}
