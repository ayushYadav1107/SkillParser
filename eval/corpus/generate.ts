/**
 * @fileOverview Corpus builder. `npm run eval:corpus`.
 *
 * Writes two things with very different lifecycles:
 *
 *   - `eval/ground_truth/records/*.json` and `manifest.json` — the **labels**.
 *     Small, diffable, and checked into git. These are the dataset; everything else
 *     is derived from them.
 *   - `eval/ground_truth/documents/*` — the **rendered documents**. Roughly 20 MB
 *     of PDFs and JPEGs, deterministic from the labels, and therefore gitignored.
 *     Checking in generated binaries would bloat the repository and invite the two
 *     to drift apart.
 *
 * The manifest records a SHA-256 for every PDF so a reviewer can confirm their
 * regenerated corpus matches the one the reported numbers came from. Scanned JPEGs
 * carry a hash too, but it is advisory: the raster backend resolves fonts through
 * the host OS, so scans are reproducible per-machine rather than across machines.
 *
 * Experimental design
 * -------------------
 * The corpus is a 2×2 factorial: {single-column, two-column} × {digital, scanned}.
 * Every record is rendered in all four cells, which means layout and modality can
 * be varied independently *with the content held constant*. That is what makes a
 * statement like "column interleaving costs 6 F1 points, and OCR triples the cost"
 * a measurement rather than a comparison of two different piles of documents.
 *
 * Running all four cells is 4× the API budget, so `manifest.primarySplit` also
 * defines a balanced one-condition-per-record assignment (15 documents per cell)
 * for cheap routine runs. `--condition all` opts into the full factorial.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { paths } from '../paths';
import { layoutResume, type ColumnLayout } from './layout';
import { generateCorpusRecords, CORPUS_SEED, CORPUS_SIZE, type ResumeRecord } from './records';
import { renderPdf, renderScan, scanProfileFor } from './render';

export const GENERATOR_VERSION = '1.0.0';

export type Modality = 'digital' | 'scanned';
export type Condition =
  | 'single-column-digital'
  | 'two-column-digital'
  | 'single-column-scanned'
  | 'two-column-scanned';

export const CONDITIONS: Condition[] = [
  'single-column-digital',
  'two-column-digital',
  'single-column-scanned',
  'two-column-scanned',
];

export function splitCondition(c: Condition): { layout: ColumnLayout; modality: Modality } {
  const scanned = c.endsWith('scanned');
  return {
    layout: c.startsWith('single') ? 'single-column' : 'two-column',
    modality: scanned ? 'scanned' : 'digital',
  };
}

export interface ManifestDocument {
  id: string;
  recordId: string;
  condition: Condition;
  layout: ColumnLayout;
  modality: Modality;
  file: string;
  mimeType: string;
  bytes: number;
  pages: number;
  sha256: string;
}

export interface Manifest {
  generatorVersion: string;
  seed: number;
  recordCount: number;
  conditions: Condition[];
  /** One condition per record, balanced across the four cells. Cheap default run. */
  primarySplit: string[];
  documents: ManifestDocument[];
  notes: string[];
}

export async function generateCorpus(opts: { size?: number; seed?: number; quiet?: boolean } = {}): Promise<Manifest> {
  const size = opts.size ?? CORPUS_SIZE;
  const seed = opts.seed ?? CORPUS_SEED;
  const log = opts.quiet ? () => {} : (m: string) => console.log(m);

  rmSync(paths.documentsDir, { recursive: true, force: true });
  rmSync(paths.recordsDir, { recursive: true, force: true });
  mkdirSync(paths.recordsDir, { recursive: true });
  mkdirSync(paths.documentsDir, { recursive: true });

  const records = generateCorpusRecords(size, seed);
  const documents: ManifestDocument[] = [];
  const primarySplit: string[] = [];

  for (const [index, record] of records.entries()) {
    writeFileSync(
      join(paths.recordsDir, `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8'
    );

    for (const condition of CONDITIONS) {
      const doc = await renderCondition(record, condition);
      documents.push(doc);
    }

    // Balanced assignment: record 0 → cell 0, record 1 → cell 1, and so on.
    primarySplit.push(`${record.id}__${CONDITIONS[index % CONDITIONS.length]}`);
    if ((index + 1) % 10 === 0) log(`  rendered ${index + 1}/${records.length} records`);
  }

  const manifest: Manifest = {
    generatorVersion: GENERATOR_VERSION,
    seed,
    recordCount: records.length,
    conditions: CONDITIONS,
    primarySplit,
    documents,
    notes: [
      'Records are the dataset; documents are derived and gitignored. Run `npm run eval:corpus` to rebuild them.',
      'PDF checksums are stable across machines (pdfkit uses built-in Type 1 font metrics and a pinned document date).',
      'Scanned JPEG checksums are stable per machine only: the raster backend resolves fonts through the host OS.',
      'All content is synthetic. No real person appears in this corpus.',
    ],
  };

  writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`Wrote ${records.length} records and ${documents.length} documents to eval/ground_truth/.`);
  return manifest;
}

async function renderCondition(record: ResumeRecord, condition: Condition): Promise<ManifestDocument> {
  const { layout, modality } = splitCondition(condition);
  const pages = layoutResume(record, layout);
  const id = `${record.id}__${condition}`;

  if (modality === 'digital') {
    const buffer = await renderPdf(pages);
    const file = `${id}.pdf`;
    writeFileSync(join(paths.documentsDir, file), buffer);
    return {
      id,
      recordId: record.id,
      condition,
      layout,
      modality,
      file,
      mimeType: 'application/pdf',
      bytes: buffer.length,
      pages: pages.length,
      sha256: sha256(buffer),
    };
  }

  const profile = scanProfileFor(record.seed ^ hashCondition(condition));
  const images = renderScan(pages, profile, record.seed ^ hashCondition(condition));

  // Multi-page scans are written as page-1 only: sending a model the first page of a
  // scan is what an ATS does with an image upload, and stitching pages into one tall
  // JPEG would create a document shape that exists nowhere in the real world.
  const buffer = images[0];
  const file = `${id}.jpg`;
  writeFileSync(join(paths.documentsDir, file), buffer);
  return {
    id,
    recordId: record.id,
    condition,
    layout,
    modality,
    file,
    mimeType: 'image/jpeg',
    bytes: buffer.length,
    pages: 1,
    sha256: sha256(buffer),
  };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashCondition(condition: string): number {
  let h = 0;
  for (let i = 0; i < condition.length; i += 1) h = (Math.imul(h, 31) + condition.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Entry point when run directly (`npm run eval:corpus`).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('eval/corpus/generate.ts')) {
  const sizeArg = process.argv.find((a) => a.startsWith('--size='));
  generateCorpus({ size: sizeArg ? Number.parseInt(sizeArg.split('=')[1], 10) : undefined }).catch(
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
