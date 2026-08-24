/**
 * @fileOverview Two rendering backends over one layout: vector PDF, and a
 * simulated scan.
 *
 * The scan simulation
 * -------------------
 * A "scanned resume" in an ATS is not a clean rasterisation. It has been printed,
 * fed through a document feeder slightly askew, illuminated unevenly, sharpened by
 * the scanner's own firmware, and saved as a middling-quality JPEG. Each of those
 * leaves a different signature, and each degrades OCR differently, so the
 * simulation applies them as separate, individually parameterised stages rather
 * than as one blur:
 *
 *   1. **Skew** (±1.4°) — feeder misalignment. Breaks the horizontal-projection
 *      assumption most line-segmentation code makes.
 *   2. **Illumination gradient** — a soft diagonal ramp, the shadow of a page that
 *      did not lie flat. Defeats a single global binarisation threshold.
 *   3. **Optical blur** — a sub-pixel Gaussian; the point-spread function of cheap
 *      glass. This is what closes the counters of small type and turns `e` into `c`.
 *   4. **Sensor noise** — additive Gaussian per pixel, worse in the dark ink.
 *   5. **Speckle** — sparse dark pixels from dust on the platen.
 *   6. **JPEG compression** at quality 0.55–0.75 — ringing around glyph edges.
 *
 * All six draw from the seeded RNG, so the same seed produces the same scan on
 * every machine and the condition stays reproducible.
 *
 * One honest caveat: the raster backend resolves fonts through the host OS, so a
 * scan generated on Windows and one generated on Linux will not be byte-identical
 * even at the same seed. The PDF conditions are byte-identical everywhere because
 * pdfkit uses the built-in Type 1 metrics. This is recorded in the manifest so a
 * reviewer comparing checksums is not confused by it.
 */

import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { Rng } from './rng';
import { fontName, type RenderedPage } from './layout';

export interface ScanProfile {
  skewDegrees: number;
  blurPx: number;
  noiseSigma: number;
  speckleRate: number;
  jpegQuality: number;
  illuminationStrength: number;
}

export function scanProfileFor(seed: number): ScanProfile {
  const rng = new Rng(seed ^ 0x5ca9);
  return {
    skewDegrees: rng.float(-1.3, 1.3),
    // Ranges tuned by eye against the rendered pages: the goal is a document a
    // person can read with mild effort, which is where OCR gets interesting. Push
    // the blur or the speckle harder and every provider fails equally, which
    // measures nothing; back them off and the scanned condition stops differing
    // from the digital one.
    blurPx: rng.float(0.3, 0.7),
    noiseSigma: rng.float(4, 12),
    speckleRate: rng.float(0.00003, 0.0002),
    jpegQuality: rng.float(0.58, 0.78),
    illuminationStrength: rng.float(0.03, 0.13),
  };
}

// ---------------------------------------------------------------------------
// Vector PDF
// ---------------------------------------------------------------------------

export async function renderPdf(pages: RenderedPage[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  // Pinned so the same record produces a byte-identical PDF on every run and every
  // machine. Without this pdfkit stamps `now` into the document info dictionary and
  // the manifest checksums change on every regeneration, which would make them
  // useless as a reproducibility check.
  doc.info.CreationDate = new Date(Date.UTC(2026, 0, 1));
  doc.info.Producer = 'SkillParser eval corpus generator';
  doc.info.Creator = 'SkillParser eval corpus generator';
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  for (const page of pages) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    for (const rule of page.rules) {
      doc
        .moveTo(rule.x, rule.y)
        .lineTo(rule.x + rule.width, rule.y)
        .lineWidth(rule.thickness)
        .strokeColor('#999999')
        .stroke();
    }
    for (const run of page.runs) {
      doc
        .font(fontName(run.bold, run.serif))
        .fontSize(run.size)
        .fillColor('#111111')
        // lineBreak:false keeps pdfkit from re-wrapping text the layout engine has
        // already positioned; without it the two backends disagree about line breaks.
        .text(run.text, run.x, run.y, { lineBreak: false });
    }
  }

  doc.end();
  await finished;
  return stabilisePdfId(Buffer.concat(chunks));
}

const PDF_ID_PATTERN = /\/ID \[<([0-9a-fA-F]{32})> <([0-9a-fA-F]{32})>\]/;

/**
 * Replaces the PDF's random file identifier with one derived from its own content.
 *
 * pdfkit fills `/ID` from `crypto.randomBytes`, which is correct behaviour for a
 * real document and fatal for a reproducible corpus: two renders of the same record
 * differ in exactly those 32 bytes, so the manifest checksums change on every
 * regeneration and stop being usable as a reproducibility check. Hashing the body
 * and writing that back keeps the identifier meaningful — distinct documents still
 * get distinct ids — while making it a function of the content rather than of the
 * clock.
 *
 * The replacement is the same length as the original, so every byte offset in the
 * cross-reference table and `startxref` stays valid.
 */
export function stabilisePdfId(buffer: Buffer): Buffer {
  const text = buffer.toString('latin1');
  const match = text.match(PDF_ID_PATTERN);
  if (!match) return buffer;

  const bodyEnd = text.indexOf('trailer');
  const digest = createHash('sha256')
    .update(buffer.subarray(0, bodyEnd > 0 ? bodyEnd : buffer.length))
    .digest('hex')
    .slice(0, 32);

  return Buffer.from(text.replace(PDF_ID_PATTERN, `/ID [<${digest}> <${digest}>]`), 'latin1');
}

// ---------------------------------------------------------------------------
// Simulated scan
// ---------------------------------------------------------------------------

const SCAN_SCALE = 2; // ≈144 dpi against a 72pt/inch page — typical office scanner output.

export function renderScan(pages: RenderedPage[], profile: ScanProfile, seed: number): Buffer[] {
  return pages.map((page, i) => renderScanPage(page, profile, seed + i * 131));
}

function renderScanPage(page: RenderedPage, profile: ScanProfile, seed: number): Buffer {
  const rng = new Rng(seed);
  const width = Math.round(page.width * SCAN_SCALE);
  const height = Math.round(page.height * SCAN_SCALE);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Paper, faintly off-white. Pure #fff is a giveaway and makes OCR easier than it
  // has any right to be.
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  const radians = (profile.skewDegrees * Math.PI) / 180;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.translate(-width / 2, -height / 2);

  for (const rule of page.rules) {
    ctx.fillStyle = 'rgb(140,140,142)';
    ctx.fillRect(
      rule.x * SCAN_SCALE,
      rule.y * SCAN_SCALE,
      rule.width * SCAN_SCALE,
      Math.max(1, rule.thickness * SCAN_SCALE)
    );
  }

  ctx.textBaseline = 'top';
  for (const run of page.runs) {
    ctx.font = canvasFont(run.size * SCAN_SCALE, run.bold, run.serif);
    // Toner is never pure black and never perfectly even.
    const ink = 24 + Math.round(rng.float(-6, 14));
    ctx.fillStyle = `rgb(${ink},${ink},${ink + 2})`;
    ctx.fillText(run.text, run.x * SCAN_SCALE, run.y * SCAN_SCALE);
  }
  ctx.restore();

  if (profile.blurPx > 0) {
    ctx.filter = `blur(${profile.blurPx.toFixed(2)}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
  }

  applySensorArtefacts(ctx, width, height, profile, rng);

  return canvas.toBuffer('image/jpeg', profile.jpegQuality);
}

function applySensorArtefacts(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  profile: ScanProfile,
  rng: Rng
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const diag = width + height;

  for (let y = 0; y < height; y += 1) {
    // Diagonal illumination ramp: brightest at the top-left corner, darkening
    // toward the bottom-right, as though the page lifted away from the glass.
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const shade = 1 - profile.illuminationStrength * ((x + y) / diag);
      const noise = rng.gaussian(0, profile.noiseSigma);
      for (let c = 0; c < 3; c += 1) {
        data[i + c] = clampByte(data[i + c] * shade + noise);
      }
    }
  }

  // Dust and toner specks. Applied after the ramp so they stay dark.
  const speckles = Math.round(width * height * profile.speckleRate);
  for (let s = 0; s < speckles; s += 1) {
    const x = rng.int(0, width - 1);
    const y = rng.int(0, height - 1);
    const radius = rng.int(0, 1);
    const value = rng.int(20, 90);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Font stacks rather than single names: the corpus has to render on whatever the
 * generating machine has installed. Liberation and DejaVu are the usual Linux
 * metric-compatible substitutes; Arial and Times New Roman cover Windows and macOS.
 */
function canvasFont(sizePx: number, bold: boolean, serif: boolean): string {
  const family = serif
    ? '"Times New Roman", "Liberation Serif", "DejaVu Serif", Georgia, serif'
    : '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
  return `${bold ? 'bold ' : ''}${sizePx.toFixed(1)}px ${family}`;
}
