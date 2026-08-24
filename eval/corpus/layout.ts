/**
 * @fileOverview Layout engine: a record plus a condition becomes positioned glyph runs.
 *
 * There is one layout engine and two rendering backends (vector PDF, raster scan)
 * rather than two independent renderers. That matters for the experiment: the
 * digital and scanned conditions must differ *only* in image degradation, so that
 * the difference in score between them is attributable to the scan and nothing
 * else. Two renderers would inevitably drift in line breaks and spacing, and the
 * scan arm would then be measuring "a slightly different document" as well.
 *
 * The two-column emission order is the single most important decision in this file
 * ------------------------------------------------------------------------------
 * A two-column PDF can store its text in either of two orders. Column-major —
 * everything in the left column, then everything in the right — extracts cleanly
 * with any text extractor and makes the two-column condition nearly as easy as the
 * one-column condition. Row-major — line by line across both columns, the way a
 * layout engine that walks the visual grid emits it — interleaves the columns in
 * the content stream, so a naive extractor produces `Principal Engineer  Erlang /
 * Quintaline Systems  Chaos engineering` and hands the model a shuffled document.
 *
 * Row-major is what a large share of real templates produce, and it is the case
 * that actually distinguishes a good preprocessor from a bad one. This engine emits
 * row-major on purpose. Building the corpus the other way would have produced much
 * better-looking numbers and would have measured nothing.
 */

import PDFDocument from 'pdfkit';
import type { ResumeRecord } from './records';

export interface Run {
  text: string;
  /** Points from the left edge of the page. */
  x: number;
  /** Points from the top edge to the text baseline's line box top. */
  y: number;
  size: number;
  bold: boolean;
  serif: boolean;
}

/**
 * A horizontal hairline under a section heading.
 *
 * Kept as a vector primitive rather than a row of box-drawing characters. Drawing
 * it as text looked fine until the extractor got hold of it: U+2500 is outside
 * Helvetica's WinAnsi encoding, so it rendered as a row of `%`, and — worse — the
 * full-width run of glyphs bridged the gutter between the columns and made the
 * two-column pages look single-column to any coverage-based column detector. A rule
 * is a line, so it is drawn as one.
 */
export interface Rule {
  x: number;
  y: number;
  width: number;
  thickness: number;
}

export interface RenderedPage {
  width: number;
  height: number;
  runs: Run[];
  rules: Rule[];
}

export type ColumnLayout = 'single-column' | 'two-column';

const PAGE = { width: 612, height: 792, margin: 52 } as const;
const RULE_GAP = 6;

/** One shared measuring document. Creating a PDFDocument per string is ~40x slower. */
let measurer: InstanceType<typeof PDFDocument> | null = null;
function measure(text: string, size: number, bold: boolean, serif: boolean): number {
  if (!measurer) measurer = new PDFDocument({ size: 'LETTER' });
  measurer.font(fontName(bold, serif)).fontSize(size);
  return measurer.widthOfString(text);
}

export function fontName(bold: boolean, serif: boolean): string {
  if (serif) return bold ? 'Times-Bold' : 'Times-Roman';
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

// ---------------------------------------------------------------------------
// A tiny block model: each column is a stack of blocks, each block a stack of lines.
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  size: number;
  bold: boolean;
  serif: boolean;
  /** Extra space above this line, in points. */
  spaceBefore: number;
  /** Draw a hairline rule under this line — the usual section-heading treatment. */
  rule?: boolean;
  /**
   * Text pinned to the right edge of the column on this same line — the
   * right-aligned date convention. It becomes a second run at the same `y` with a
   * large horizontal gap before it, which is exactly the shape that trips naive
   * text extraction.
   */
  rightText?: string;
  rightSize?: number;
}

/**
 * Renders the title / company / date block at the top of an entry in whichever of
 * the five conventional arrangements this resume uses.
 */
function pushEntryHeader(
  lines: Line[],
  parts: { title: string; company: string; date: string },
  style: ResumeRecord['style'],
  opts: { width: number; serif: boolean; titleSize: number; metaSize: number; spaceBefore: number }
): void {
  const { serif, titleSize, metaSize, spaceBefore } = opts;
  const sep = style.contactSeparator;

  switch (style.entryHeaderStyle) {
    case 'right-aligned-dates':
      lines.push({
        text: parts.title,
        size: titleSize,
        bold: true,
        serif,
        spaceBefore,
        rightText: parts.date,
        rightSize: metaSize,
      });
      lines.push({ text: parts.company, size: metaSize, bold: false, serif, spaceBefore: 1 });
      break;

    case 'title-inline-company':
      lines.push({ text: `${parts.title}, ${parts.company}`, size: titleSize, bold: true, serif, spaceBefore });
      lines.push({ text: parts.date, size: metaSize, bold: false, serif, spaceBefore: 1 });
      break;

    case 'company-inline-title':
      lines.push({ text: `${parts.company} — ${parts.title}`, size: titleSize, bold: true, serif, spaceBefore });
      lines.push({ text: parts.date, size: metaSize, bold: false, serif, spaceBefore: 1 });
      break;

    case 'company-title-date-stacked':
      lines.push({ text: parts.company, size: titleSize, bold: true, serif, spaceBefore });
      lines.push({ text: `${parts.title}${sep}${parts.date}`, size: metaSize, bold: false, serif, spaceBefore: 1 });
      break;

    default:
      lines.push({ text: parts.title, size: titleSize, bold: true, serif, spaceBefore });
      lines.push({ text: `${parts.company}${sep}${parts.date}`, size: metaSize, bold: false, serif, spaceBefore: 1 });
      break;
  }
}

/** Skills as a comma list, optionally broken into inline category groups. */
function renderSkillLine(skills: string[], categorised: boolean): string {
  if (!categorised || skills.length < 4) return skills.join(', ');
  const cut = Math.ceil(skills.length / 2);
  return `Core: ${skills.slice(0, cut).join(', ')}   Also: ${skills.slice(cut).join(', ')}`;
}

export function layoutResume(record: ResumeRecord, layout: ColumnLayout): RenderedPage[] {
  return layout === 'single-column' ? layoutSingle(record) : layoutTwo(record);
}

// ---------------------------------------------------------------------------

function layoutSingle(record: ResumeRecord): RenderedPage[] {
  const { truth, style } = record;
  const serif = style.serifBody;
  const width = PAGE.width - PAGE.margin * 2;
  const lines: Line[] = [];

  lines.push({ text: truth.personal.name, size: 19, bold: true, serif, spaceBefore: 0 });
  const contact = [truth.personal.email, truth.personal.phone, truth.personal.location]
    .filter(Boolean)
    .join(style.contactSeparator);
  if (contact) lines.push({ text: contact, size: 9.5, bold: false, serif, spaceBefore: 5 });
  for (const distractor of style.distractors) {
    lines.push({ text: distractor, size: 9, bold: false, serif, spaceBefore: 1 });
  }

  if (style.summaryText) {
    pushHeading(lines, style.headings.summary, serif);
    pushWrapped(lines, style.summaryText, width, 9.5, false, serif, 0);
  }

  if (truth.experience.length) {
    pushHeading(lines, style.headings.experience, serif);
    truth.experience.forEach((entry, i) => {
      pushEntryHeader(
        lines,
        { title: entry.title, company: entry.company, date: entry.duration },
        style,
        { width, serif, titleSize: 11, metaSize: 9.5, spaceBefore: i === 0 ? 4 : 9 }
      );
      pushWrapped(lines, `${style.bullet} ${entry.description}`, width, 9.5, false, serif, 2);
    });
  }

  if (truth.education.length) {
    pushHeading(lines, style.headings.education, serif);
    truth.education.forEach((entry, i) => {
      lines.push({ text: entry.degree, size: 10.5, bold: true, serif, spaceBefore: i === 0 ? 4 : 7 });
      lines.push({
        text: `${entry.institution}${style.contactSeparator}${entry.graduationDate}`,
        size: 9.5,
        bold: false,
        serif,
        spaceBefore: 1,
      });
    });
  }

  if (truth.skills.length) {
    pushHeading(lines, style.headings.skills, serif);
    if (style.skillsAsBullets) {
      truth.skills.forEach((s, i) =>
        lines.push({ text: `${style.bullet} ${s}`, size: 9.5, bold: false, serif, spaceBefore: i === 0 ? 4 : 1 })
      );
    } else {
      pushWrapped(lines, renderSkillLine(truth.skills, style.skillCategories), width, 9.5, false, serif, 4);
    }
  }

  if (truth.certifications.length) {
    pushHeading(lines, style.headings.certifications, serif);
    truth.certifications.forEach((c, i) =>
      lines.push({ text: `${style.bullet} ${c}`, size: 9.5, bold: false, serif, spaceBefore: i === 0 ? 4 : 1 })
    );
  }

  if (style.projects?.length) {
    pushHeading(lines, 'PROJECTS', serif);
    style.projects.forEach((p, i) =>
      pushWrapped(lines, `${style.bullet} ${p}`, width, 9.5, false, serif, i === 0 ? 4 : 2)
    );
  }

  return paginate([{ x: PAGE.margin, width, lines }]);
}

// ---------------------------------------------------------------------------

function layoutTwo(record: ResumeRecord): RenderedPage[] {
  const { truth, style } = record;
  const serif = style.serifBody;
  const total = PAGE.width - PAGE.margin * 2;
  const gutter = 30;
  const mainWidth = Math.floor((total - gutter) * 0.63);
  const sideWidth = total - gutter - mainWidth;
  const sideX = PAGE.margin + mainWidth + gutter;

  const main: Line[] = [];
  const side: Line[] = [];

  main.push({ text: truth.personal.name, size: 18, bold: true, serif, spaceBefore: 0 });
  const contactBits = [truth.personal.email, truth.personal.phone, truth.personal.location].filter(Boolean);
  // In a narrow main column the contact line is usually stacked, not inline.
  [...contactBits, ...style.distractors].forEach((bit, i) =>
    main.push({ text: bit, size: 9, bold: false, serif, spaceBefore: i === 0 ? 5 : 1 })
  );

  if (style.summaryText) {
    pushHeading(main, style.headings.summary, serif);
    pushWrapped(main, style.summaryText, mainWidth, 9, false, serif, 0);
  }

  if (truth.experience.length) {
    pushHeading(main, style.headings.experience, serif);
    truth.experience.forEach((entry, i) => {
      pushEntryHeader(
        main,
        { title: entry.title, company: entry.company, date: entry.duration },
        style,
        { width: mainWidth, serif, titleSize: 10.5, metaSize: 9, spaceBefore: i === 0 ? 4 : 9 }
      );
      pushWrapped(main, entry.description, mainWidth, 9, false, serif, 2);
    });
  }

  if (style.projects?.length) {
    pushHeading(main, 'PROJECTS', serif);
    style.projects.forEach((p, i) => pushWrapped(main, `${style.bullet} ${p}`, mainWidth, 9, false, serif, i === 0 ? 4 : 2));
  }

  // The sidebar carries skills, education and certifications — the arrangement most
  // two-column resume templates use.
  if (truth.skills.length) {
    pushHeading(side, style.headings.skills, serif);
    truth.skills.forEach((s, i) =>
      pushWrapped(side, s, sideWidth, 9, false, serif, i === 0 ? 4 : 2)
    );
  }

  if (truth.education.length) {
    pushHeading(side, style.headings.education, serif);
    truth.education.forEach((entry, i) => {
      pushWrapped(side, entry.degree, sideWidth, 9, true, serif, i === 0 ? 4 : 8);
      pushWrapped(side, entry.institution, sideWidth, 8.5, false, serif, 1);
      side.push({ text: entry.graduationDate, size: 8.5, bold: false, serif, spaceBefore: 1 });
    });
  }

  if (truth.certifications.length) {
    pushHeading(side, style.headings.certifications, serif);
    truth.certifications.forEach((c, i) => pushWrapped(side, c, sideWidth, 8.5, false, serif, i === 0 ? 4 : 4));
  }

  return paginate([
    { x: PAGE.margin, width: mainWidth, lines: main },
    { x: sideX, width: sideWidth, lines: side },
  ]);
}

// ---------------------------------------------------------------------------

function pushHeading(lines: Line[], text: string, serif: boolean): void {
  lines.push({ text, size: 10.5, bold: true, serif, spaceBefore: lines.length ? 15 : 0, rule: true });
}

function pushWrapped(
  lines: Line[],
  text: string,
  width: number,
  size: number,
  bold: boolean,
  serif: boolean,
  spaceBefore: number
): void {
  const wrapped = wrap(text, width, size, bold, serif);
  wrapped.forEach((t, i) =>
    lines.push({ text: t, size, bold, serif, spaceBefore: i === 0 ? spaceBefore : 0 })
  );
}

export function wrap(text: string, width: number, size: number, bold: boolean, serif: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${line} ${words[i]}`;
    // 0.98 of the column: the raster backend measures with a different font engine,
    // and a hair of slack keeps a line that fits in the PDF from spilling in the scan.
    if (measure(candidate, size, bold, serif) <= width * 0.98) line = candidate;
    else {
      out.push(line);
      line = words[i];
    }
  }
  out.push(line);
  return out;
}

interface Column {
  x: number;
  width: number;
  lines: Line[];
}

/**
 * Flows columns down the page, breaking to a new page when a column runs out of
 * room, and emits every page's runs in **row-major visual order**: sorted by
 * vertical band first, then left to right within the band. See the file header for
 * why this ordering is the point rather than an implementation detail.
 */
function paginate(columns: Column[]): RenderedPage[] {
  const bottom = PAGE.height - PAGE.margin;
  const perColumnPages: Array<Array<Run[]>> = [];
  const perColumnRules: Array<Array<Rule[]>> = [];

  for (const column of columns) {
    const pages: Run[][] = [[]];
    const rulePages: Rule[][] = [[]];
    let y = PAGE.margin;
    let pageIndex = 0;

    for (const line of column.lines) {
      const lineHeight = line.size * 1.32;
      const advance = line.spaceBefore + lineHeight;
      if (y + advance > bottom) {
        pageIndex += 1;
        if (!pages[pageIndex]) pages[pageIndex] = [];
        if (!rulePages[pageIndex]) rulePages[pageIndex] = [];
        y = PAGE.margin;
      }
      const drawY = y === PAGE.margin ? y : y + line.spaceBefore;
      pages[pageIndex].push({
        text: line.text,
        x: column.x,
        y: drawY,
        size: line.size,
        bold: line.bold,
        serif: line.serif,
      });
      if (line.rightText) {
        const rightSize = line.rightSize ?? line.size;
        const rightWidth = measure(line.rightText, rightSize, false, line.serif);
        pages[pageIndex].push({
          text: line.rightText,
          x: column.x + column.width - rightWidth,
          // Nudged onto the same visual row as the title despite the size
          // difference, which is what a real template does.
          y: drawY + (lineHeight - rightSize * 1.32) * 0.6,
          size: rightSize,
          bold: false,
          serif: line.serif,
        });
      }
      if (line.rule) {
        rulePages[pageIndex].push({
          x: column.x,
          y: drawY + lineHeight - RULE_GAP + 5,
          width: column.width,
          thickness: 0.6,
        });
      }
      y = drawY + lineHeight;
    }
    perColumnPages.push(pages);
    perColumnRules.push(rulePages);
  }

  const pageCount = Math.max(...perColumnPages.map((p) => p.length));
  const out: RenderedPage[] = [];

  for (let p = 0; p < pageCount; p += 1) {
    const runs = perColumnPages.flatMap((pages) => pages[p] ?? []);
    const rules = perColumnRules.flatMap((pages) => pages[p] ?? []);
    // Row-major: band by vertical position (8pt tolerance absorbs baseline
    // differences between a 10.5pt heading and a 9pt body line on the same row),
    // then left to right inside the band.
    runs.sort((a, b) => {
      const band = Math.round(a.y / 8) - Math.round(b.y / 8);
      return band !== 0 ? band : a.x - b.x;
    });
    out.push({ width: PAGE.width, height: PAGE.height, runs, rules });
  }

  return out;
}

export const PAGE_GEOMETRY = PAGE;
