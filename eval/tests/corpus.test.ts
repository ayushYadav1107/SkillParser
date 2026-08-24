import { describe, it, assert, assertEqual } from './harness';
import { Rng } from '../corpus/rng';
import { generateCorpusRecords, generateRecord } from '../corpus/records';
import { layoutResume } from '../corpus/layout';
import { renderPdf } from '../corpus/render';

describe('corpus generation', () => {
  it('produces identical records from the same seed', () => {
    // Without this the reported numbers are not reproducible and the whole exercise
    // is decorative.
    const a = generateRecord('rX', 12345);
    const b = generateRecord('rX', 12345);
    assertEqual(a, b);
  });

  it('produces different records from different seeds', () => {
    const a = generateRecord('rX', 1);
    const b = generateRecord('rX', 2);
    assert(JSON.stringify(a.truth) !== JSON.stringify(b.truth), 'seeds should diverge');
  });

  it('keeps each record independent of the corpus size', () => {
    // Per-record seeds rather than one shared stream: appending a record must not
    // shift the content of every record before it, or the corpus stops being stable
    // across versions of the generator.
    const small = generateCorpusRecords(3);
    const large = generateCorpusRecords(10);
    assertEqual(small[2], large[2]);
  });

  it('renders byte-identical PDFs across runs', async () => {
    const record = generateRecord('rX', 999);
    const pages = layoutResume(record, 'single-column');
    const first = await renderPdf(pages);
    const second = await renderPdf(layoutResume(record, 'single-column'));
    assert(first.equals(second), 'PDF bytes must be stable for the manifest checksums to mean anything');
  });

  it('covers the adversarial cases the error taxonomy needs', () => {
    const records = generateCorpusRecords(60);
    const withoutEducation = records.filter((r) => r.truth.education.length === 0).length;
    const withoutCertifications = records.filter((r) => r.truth.certifications.length === 0).length;
    const withoutPhone = records.filter((r) => r.truth.personal.phone === '').length;
    const repeatEmployer = records.filter((r) => r.meta.hasRepeatEmployer).length;
    const creativeHeadings = records.filter((r) => r.meta.headingStyle === 'creative').length;
    const rightAligned = records.filter((r) => r.meta.entryHeaderStyle === 'right-aligned-dates').length;
    const noExperience = records.filter((r) => r.truth.experience.length === 0).length;

    assert(withoutEducation >= 2, `too few resumes without education: ${withoutEducation}`);
    assert(withoutCertifications >= 10, `too few without certifications: ${withoutCertifications}`);
    assert(withoutPhone >= 1, `no resume without a phone number`);
    assert(repeatEmployer >= 1, `no promotion case (two roles at one employer)`);
    assert(creativeHeadings >= 10, `too few unconventional headings: ${creativeHeadings}`);
    assert(rightAligned >= 8, `too few right-aligned date layouts: ${rightAligned}`);
    assert(noExperience >= 1, `no resume without work history`);
  });

  it('varies date formats across the corpus', () => {
    const formats = new Set(generateCorpusRecords(60).map((r) => r.meta.dateFormat));
    assertEqual(formats.size, 4, `expected all four date formats, saw ${[...formats].join(', ')}`);
  });

  it('includes names that defeat a Firstname-Lastname assumption', () => {
    const names = generateCorpusRecords(60).map((r) => r.truth.personal.name);
    assert(names.some((n) => /[-]/.test(n)), 'no hyphenated name');
    assert(names.some((n) => n !== n.normalize('NFD').replace(/[̀-ͯ]/g, '')), 'no diacritics');
    assert(names.some((n) => n === n.toUpperCase()), 'no ALL-CAPS name');
    assert(names.some((n) => n.split(/\s+/).length > 2), 'no multi-particle surname');
  });

  it('lays a two-column resume out in visual row order', () => {
    // Column-major emission would make the two-column condition nearly as easy as
    // the one-column one and would measure nothing.
    const record = generateRecord('rX', 4242);
    const [page] = layoutResume(record, 'two-column');
    const xs = page.runs.map((r) => r.x);
    const distinctColumns = new Set(xs).size;
    assert(distinctColumns >= 2, 'two columns expected');
    let interleavings = 0;
    for (let i = 1; i < page.runs.length; i += 1) {
      if (page.runs[i].x !== page.runs[i - 1].x) interleavings += 1;
    }
    assert(interleavings > 4, `runs are not interleaved (${interleavings} column switches)`);
  });

  it('gives the seeded RNG a stable, uniform-ish stream', () => {
    const rng = new Rng('fixed-seed');
    const values = Array.from({ length: 5000 }, () => rng.next());
    assert(values.every((v) => v >= 0 && v < 1), 'out of range');
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    assert(Math.abs(mean - 0.5) < 0.03, `mean ${mean} is not near 0.5`);
    assertEqual(new Rng('fixed-seed').next(), values[0]);
  });

  it('samples without replacement', () => {
    const rng = new Rng(7);
    const picked = rng.sample(['a', 'b', 'c', 'd'], 4);
    assertEqual([...picked].sort(), ['a', 'b', 'c', 'd']);
  });
});
