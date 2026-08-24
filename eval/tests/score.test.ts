import { describe, it, assert, assertEqual } from './harness';
import { prf, scoreDocument } from '../metrics/score';
import type { GroundTruthResume, ParsedResume } from '../../src/lib/resume-schema';

const truth: GroundTruthResume = {
  personal: {
    name: 'Ifeoma Nakamura',
    email: 'ifeoma.nakamura@mailbox.dev',
    phone: '+91 74097 09968',
    location: 'Pune, India',
  },
  skills: ['Go', 'Kafka', 'PostgreSQL'],
  certifications: ['Certified Kubernetes Administrator (CKA)'],
  experience: [
    {
      title: 'Staff Software Engineer',
      company: 'Halcyon Grid Systems',
      duration: 'Jan 2023 - Present',
      description: 'Cut p99 checkout latency from 840ms to 210ms.',
    },
    {
      title: 'Backend Engineer',
      company: 'Umbra Robotics',
      duration: 'Jun 2020 - Dec 2022',
      description: 'Migrated 43 services off a shared Postgres instance.',
    },
  ],
  education: [
    { degree: 'B.Tech in Computer Science and Engineering', institution: 'Fenwold University', graduationDate: 'May 2020' },
  ],
};

function perfectPrediction(): ParsedResume {
  return JSON.parse(JSON.stringify(truth)) as ParsedResume;
}

const opts = { scanned: false };
const countsFor = (score: ReturnType<typeof scoreDocument>, field: string) =>
  score.perField[field as keyof typeof score.perField];

describe('document scoring', () => {
  it('scores a perfect extraction at F1 1.0 with no errors', () => {
    const score = scoreDocument('d1', 'r1', truth, perfectPrediction(), opts);
    const errors = score.observations.filter((o) => o.errorCategory);
    assertEqual(errors.length, 0, JSON.stringify(errors.slice(0, 2)));
    for (const o of score.observations) {
      assert(o.outcome === 'tp' || o.outcome === 'tn', `unexpected outcome ${o.outcome} on ${o.field}`);
    }
  });

  it('counts a wrong-but-present value as one false positive and one false negative', () => {
    // Both failures happened: the right value was not produced, and a wrong one was.
    // Collapsing them into a single error would let precision and recall drift from
    // what they mean.
    const predicted = perfectPrediction();
    predicted.personal.email = 'someone.else@mailbox.dev';
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(countsFor(score, 'personal.email'), { tp: 0, fp: 1, fn: 1, tn: 0 });
  });

  it('separates a miss from a hallucination', () => {
    const missing = perfectPrediction();
    missing.personal.phone = '';
    const missScore = scoreDocument('d1', 'r1', truth, missing, opts);
    assertEqual(countsFor(missScore, 'personal.phone'), { tp: 0, fp: 0, fn: 1, tn: 0 });
    assertEqual(
      missScore.observations.find((o) => o.field === 'personal.phone')?.errorCategory,
      'MISSING_FIELD'
    );

    const noPhoneTruth: GroundTruthResume = { ...truth, personal: { ...truth.personal, phone: '' } };
    const invented = perfectPrediction();
    const hallucinationScore = scoreDocument('d1', 'r1', noPhoneTruth, invented, opts);
    assertEqual(countsFor(hallucinationScore, 'personal.phone'), { tp: 0, fp: 1, fn: 0, tn: 0 });
    assertEqual(
      hallucinationScore.observations.find((o) => o.field === 'personal.phone')?.errorCategory,
      'HALLUCINATED_FIELD'
    );
  });

  it('does not count a field absent from both sides in precision or recall', () => {
    const noLocation: GroundTruthResume = { ...truth, personal: { ...truth.personal, location: '' } };
    const predicted = perfectPrediction();
    predicted.personal.location = '';
    const score = scoreDocument('d1', 'r1', noLocation, predicted, opts);
    assertEqual(countsFor(score, 'personal.location'), { tp: 0, fp: 0, fn: 0, tn: 1 });
  });

  it('accepts a date written in a different notation', () => {
    const predicted = perfectPrediction();
    predicted.experience[0].duration = '01/2023 - Present';
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(countsFor(score, 'experience.duration').tp, 2);
  });

  it('penalises a dropped entry across its sub-fields, not just once', () => {
    // Otherwise a system that silently drops whole entries is penalised once while
    // a system that returns them badly is penalised four times — which would reward
    // dropping data over reading it imperfectly.
    const predicted = perfectPrediction();
    predicted.experience = [predicted.experience[0]];
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(countsFor(score, 'experience.entry').fn, 1);
    assertEqual(countsFor(score, 'experience.company').fn, 1);
    assertEqual(countsFor(score, 'experience.title').fn, 1);
  });

  it('flags an invented entry as spurious', () => {
    const predicted = perfectPrediction();
    predicted.experience.push({
      title: 'Chief Executive',
      company: 'Ferrite Cloud',
      duration: '1998 - 1999',
      description: '',
    });
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(countsFor(score, 'experience.entry').fp, 1);
    assert(
      score.observations.some((o) => o.errorCategory === 'SPURIOUS_ENTRY'),
      'should record a spurious entry'
    );
  });

  it('recognises reading-order bleed as its own failure mode', () => {
    // The model returned real text from the document — just from the wrong place.
    // That is a preprocessing problem, not a comprehension problem, and lumping it
    // in with "wrong value" hides the distinction that decides what to fix.
    const predicted = perfectPrediction();
    predicted.experience[0].company = 'PostgreSQL';
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(
      score.observations.find((o) => o.field === 'experience.company' && o.errorCategory)?.errorCategory,
      'COLUMN_BLEED'
    );
  });

  it('recognises OCR damage only in the scanned condition', () => {
    const predicted = perfectPrediction();
    predicted.experience[0].company = 'Halcyou Gnd Systoms';
    const scanned = scoreDocument('d1', 'r1', truth, predicted, { scanned: true });
    assertEqual(
      scanned.observations.find((o) => o.field === 'experience.company' && o.errorCategory)?.errorCategory,
      'OCR_CORRUPTION'
    );
    const digital = scoreDocument('d1', 'r1', truth, predicted, { scanned: false });
    assert(
      digital.observations.find((o) => o.field === 'experience.company' && o.errorCategory)?.errorCategory !==
        'OCR_CORRUPTION',
      'OCR damage is not a plausible explanation for a born-digital PDF'
    );
  });

  it('scores partial skill recall as partial', () => {
    const predicted = perfectPrediction();
    predicted.skills = ['Go', 'Kafka', 'Rust'];
    const score = scoreDocument('d1', 'r1', truth, predicted, opts);
    assertEqual(countsFor(score, 'skills'), { tp: 2, fp: 1, fn: 1, tn: 0 });
  });

  it('computes precision, recall and F1 from counts', () => {
    const m = prf({ tp: 8, fp: 2, fn: 2, tn: 0 });
    assertEqual(Number(m.precision.toFixed(3)), 0.8);
    assertEqual(Number(m.recall.toFixed(3)), 0.8);
    assertEqual(Number(m.f1.toFixed(3)), 0.8);
  });
});
