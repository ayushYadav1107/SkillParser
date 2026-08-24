/**
 * @fileOverview Turning a resume file into something a model can read.
 *
 * A multimodal provider takes the file as-is. A text-only provider does not, and
 * the step that bridges the gap is not neutral — it is a component of the system
 * whose failure modes get attributed to the model unless they are measured
 * separately. This module therefore exposes the preprocessing path explicitly and
 * offers two PDF strategies so the effect of the preprocessor can be isolated:
 *
 *   - `naive`        — take the PDF text layer in content-stream order. This is what
 *                      almost every "parse a PDF" tutorial does. On a two-column
 *                      resume whose generator emitted text in visual row order, it
 *                      interleaves the columns and hands the model a shuffled
 *                      document.
 *   - `column-aware` — detect the vertical gutter from glyph positions, split the
 *                      page into columns, and emit each column top-to-bottom. This
 *                      is the fix, and the delta between the two on the two-column
 *                      arm of the eval is the measurement of how much it is worth.
 *
 * Scans have no text layer at all and require OCR. `tesseract.js` is an optional
 * dependency: when it is not installed, or its language model cannot be fetched,
 * the caller gets a `CapabilityUnavailableError` and the harness records those
 * documents as skipped. Scoring them as zeros would be the easy thing to do and
 * would silently understate the provider by an amount nobody could later untangle.
 */

import { CapabilityUnavailableError } from '@/lib/llm/errors';
import type { DocumentKind, ResumeDocument } from '@/lib/llm/types';

export type PdfTextStrategy = 'naive' | 'column-aware';

export interface ExtractedText {
  text: string;
  path: 'pdf-text-layer' | 'docx-text' | 'ocr';
  latencyMs: number;
  /** Populated for PDFs: whether a two-column layout was detected. */
  columnsDetected?: number;
}

export function kindFromFilename(filename: string): DocumentKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return 'image';
}

export function mimeForKind(kind: DocumentKind, filename = ''): string {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

export function toDataUri(doc: ResumeDocument): string {
  return `data:${doc.mimeType};base64,${Buffer.from(doc.bytes).toString('base64')}`;
}

export async function extractDocumentText(
  doc: ResumeDocument,
  opts: { pdfStrategy?: PdfTextStrategy } = {}
): Promise<ExtractedText> {
  const started = Date.now();
  switch (doc.kind) {
    case 'pdf': {
      const result = await extractPdfText(doc.bytes, opts.pdfStrategy ?? 'column-aware');
      return { ...result, path: 'pdf-text-layer', latencyMs: Date.now() - started };
    }
    case 'docx': {
      const text = await extractDocxText(doc.bytes);
      return { text, path: 'docx-text', latencyMs: Date.now() - started };
    }
    case 'image': {
      const text = await runOcr(doc.bytes);
      return { text, path: 'ocr', latencyMs: Date.now() - started };
    }
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function extractPdfText(
  bytes: Uint8Array,
  strategy: PdfTextStrategy
): Promise<{ text: string; columnsDetected: number }> {
  const { getDocumentProxy } = await import('unpdf');
  // pdfjs transfers ownership of the buffer it is handed and neuters the original,
  // which breaks any caller that reuses the same document for a second provider.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const pages: string[] = [];
  let maxColumns = 1;

  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // pdfjs types the array as TextItem | TextMarkedContent; only the former has
    // glyph positions, and marked-content markers carry no text at all.
    const items: TextItem[] = (content.items as unknown[])
      .filter((it): it is { str: string; transform: number[]; width: number; height: number } => {
        const c = it as { str?: unknown; transform?: unknown };
        return typeof c.str === 'string' && Array.isArray(c.transform);
      })
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        // pdfjs y grows upward; flip it so "smaller y" means "higher on the page".
        y: viewport.height - it.transform[5],
        width: it.width ?? 0,
        height: it.height ?? 10,
      }))
      .filter((it) => it.str.trim().length > 0);

    if (items.length === 0) continue;

    if (strategy === 'naive') {
      pages.push(joinNaive(items));
      continue;
    }

    const gutter = findGutter(items, viewport.width);
    if (gutter == null) {
      pages.push(linesToText(groupIntoLines(items)));
    } else {
      maxColumns = Math.max(maxColumns, 2);
      const left = items.filter((it) => it.x + it.width / 2 < gutter);
      const right = items.filter((it) => it.x + it.width / 2 >= gutter);
      pages.push(
        [linesToText(groupIntoLines(left)), linesToText(groupIntoLines(right))]
          .filter((s) => s.trim().length > 0)
          .join('\n\n')
      );
    }
  }

  return { text: pages.join('\n\n').trim(), columnsDetected: maxColumns };
}

/**
 * Content-stream order with a newline whenever the vertical position jumps.
 * Deliberately dumb — this is the baseline the column-aware path is measured against.
 */
function joinNaive(items: TextItem[]): string {
  const out: string[] = [];
  let lastY: number | null = null;
  for (const it of items) {
    if (lastY != null && Math.abs(it.y - lastY) > it.height * 0.6) out.push('\n');
    else if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push(' ');
    out.push(it.str);
    lastY = it.y;
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Finds the x coordinate of a vertical whitespace gutter, if there is one.
 *
 * The test is coverage-based rather than clustering-based: bucket the page width,
 * mark every bucket any glyph overlaps, and look for a run of empty buckets wide
 * enough to be a real gutter and positioned near the middle
 * (25–75%). Requiring central placement matters — the blank margin down the right
 * edge of a single-column resume is a wide empty run too, and a naive "widest gap"
 * rule happily splits a one-column page in half.
 */
function findGutter(items: TextItem[], pageWidth: number): number | null {
  const BUCKETS = 100;
  const bucketWidth = pageWidth / BUCKETS;
  const occupied = new Array<boolean>(BUCKETS).fill(false);

  for (const it of items) {
    const from = Math.max(0, Math.floor(it.x / bucketWidth));
    const to = Math.min(BUCKETS - 1, Math.floor((it.x + Math.max(it.width, 1)) / bucketWidth));
    for (let b = from; b <= to; b += 1) occupied[b] = true;
  }

  let best: { start: number; end: number } | null = null;
  let runStart: number | null = null;
  for (let b = 0; b <= BUCKETS; b += 1) {
    const empty = b < BUCKETS && !occupied[b];
    if (empty && runStart == null) runStart = b;
    if (!empty && runStart != null) {
      const run = { start: runStart, end: b - 1 };
      const centre = (run.start + run.end) / 2;
      const width = run.end - run.start + 1;
      // 4 buckets ≈ 24pt on Letter. Typical resume gutters run 20–35pt, and a
      // stricter threshold silently classifies real two-column pages as
      // single-column — which would make the two-column arm look easy for the
      // wrong reason.
      if (width >= 4 && centre >= BUCKETS * 0.25 && centre <= BUCKETS * 0.75) {
        if (!best || width > best.end - best.start + 1) best = run;
      }
      runStart = null;
    }
  }

  if (!best) return null;

  const split = ((best.start + best.end) / 2) * bucketWidth;
  const left = items.filter((i) => i.x + i.width / 2 < split);
  const right = items.filter((i) => i.x + i.width / 2 >= split);
  const minority = left.length <= right.length ? left : right;
  const majority = minority === left ? right : left;

  // A gap is only a gutter if there is a genuine second column beside it, and
  // "genuine" is not a character-count ratio. A sidebar holding nine one-word
  // skills next to fourteen hundred characters of employment history is 9% of the
  // page's text and is unambiguously a column; a right-aligned date on one line is
  // a much larger share of a sparse page and is not. What separates them is
  // vertical structure — a column runs *alongside* the other column — so the test
  // is that the minority side spans several lines and that its vertical extent
  // overlaps the majority's.
  if (minority.length < 3) return null;
  if (minority.reduce((a, i) => a + i.str.length, 0) < 24) return null;

  const span = (list: TextItem[]) => ({
    top: Math.min(...list.map((i) => i.y)),
    bottom: Math.max(...list.map((i) => i.y)),
  });
  const m = span(minority);
  const M = span(majority);
  const overlap = Math.min(m.bottom, M.bottom) - Math.max(m.top, M.top);
  const minoritySpan = Math.max(m.bottom - m.top, 1);
  if (overlap / minoritySpan < 0.4) return null;

  return split;
}

function groupIntoLines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= Math.max(it.height, 6) * 0.6) last.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

function linesToText(lines: TextItem[][]): string {
  const out: string[] = [];
  let previousY: number | null = null;
  for (const line of lines) {
    const y = line[0].y;
    const height = Math.max(...line.map((i) => i.height), 6);
    // A gap of more than ~1.8 line-heights reads as a section break.
    if (previousY != null && y - previousY > height * 1.8) out.push('');
    out.push(joinLine(line));
    previousY = y;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Inserts a space only where the glyph run actually has a horizontal gap. */
function joinLine(line: TextItem[]): string {
  let text = '';
  let previousEnd: number | null = null;
  for (const it of line) {
    if (previousEnd != null) {
      const gap = it.x - previousEnd;
      if (gap > 1.2) text += gap > 12 ? '   ' : ' ';
    }
    text += it.str;
    previousEnd = it.x + it.width;
  }
  return text.replace(/\s+/g, (m) => (m.length > 2 ? '   ' : ' ')).trim();
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value.trim();
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

let ocrWorker: { recognize: (b: Buffer) => Promise<{ data: { text: string } }> } | null = null;
let ocrUnavailableReason: string | null = null;

/**
 * Lazily starts a Tesseract worker. Kept optional and lazy because it pulls a
 * ~15 MB language model over the network on first use, which is not something the
 * unit tests or a CI run without egress should be forced to do.
 */
async function runOcr(bytes: Uint8Array): Promise<string> {
  if (ocrUnavailableReason) {
    throw new CapabilityUnavailableError(ocrUnavailableReason, 'ocr');
  }
  if (!ocrWorker) {
    try {
      // Resolved through a variable so the type checker does not require the
      // optional dependency to be installed. It genuinely is optional: the harness
      // records scanned documents as skipped when it is absent.
      const specifier = 'tesseract.js';
      const tesseract = (await import(/* @vite-ignore */ specifier)) as {
        createWorker: (
          lang: string,
          oem: number,
          options: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const langPath = process.env.TESSERACT_LANG_PATH;
      ocrWorker = (await tesseract.createWorker('eng', 1, {
        ...(langPath ? { langPath } : {}),
        cachePath: process.env.TESSERACT_CACHE_PATH ?? '.tesseract-cache',
      })) as unknown as typeof ocrWorker;
    } catch (err) {
      ocrUnavailableReason =
        `OCR is unavailable, so scanned resumes cannot be sent to a text-only provider. ` +
        `Install it with \`npm install tesseract.js\`, and make sure the machine can reach ` +
        `the language-model CDN or set TESSERACT_LANG_PATH to a local copy of eng.traineddata. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`;
      throw new CapabilityUnavailableError(ocrUnavailableReason, 'ocr');
    }
  }
  const { data } = await ocrWorker!.recognize(Buffer.from(bytes));
  return data.text.trim();
}

/** Test seam: lets the offline suite assert the unavailable path without a network. */
export function __setOcrUnavailable(reason: string | null): void {
  ocrUnavailableReason = reason;
  if (reason) ocrWorker = null;
}
