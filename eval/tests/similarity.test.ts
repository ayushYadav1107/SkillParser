import { describe, it, assert, assertEqual, assertClose } from './harness';
import {
  characterSimilarity,
  levenshtein,
  matchSets,
  organizationSimilarity,
  shortFieldSimilarity,
  tokenF1,
} from '../metrics/similarity';

describe('similarity', () => {
  it('scores identical strings at 1 and disjoint ones at 0', () => {
    assertClose(tokenF1('alpha beta', 'alpha beta'), 1);
    assertClose(tokenF1('alpha beta', 'gamma delta'), 0);
  });

  it('uses multiset semantics so repetition is not free', () => {
    // Set semantics would score this 1.0 and quietly reward padding.
    const score = tokenF1('accessibility', 'accessibility accessibility accessibility');
    assert(score < 0.6, `repetition scored too highly: ${score}`);
  });

  it('recovers OCR damage through the character measure where tokens fail', () => {
    const gold = 'Quintaline Systems';
    const damaged = 'Quintalinc Systoms';
    assert(tokenF1(gold, damaged) === 0, 'no token matches exactly');
    assert(characterSimilarity(gold, damaged) > 0.85, 'characters are nearly identical');
    assert(shortFieldSimilarity(gold, damaged) > 0.85, 'the blended measure should recover it');
  });

  it('is insensitive to word order for free text', () => {
    assertClose(tokenF1('cut latency by half', 'by half cut latency'), 1);
  });

  it('ignores legal suffixes when comparing organisations', () => {
    assertClose(organizationSimilarity('Boreal Instrument Co.', 'Boreal Instrument'), 1);
  });

  it('computes edit distance correctly', () => {
    assertEqual(levenshtein('kitten', 'sitting'), 3);
    assertEqual(levenshtein('', 'abc'), 3);
    assertEqual(levenshtein('same', 'same'), 0);
  });

  it('matches each set element at most once', () => {
    const result = matchSets(['Python', 'Python'], ['Python'], shortFieldSimilarity, 0.85);
    assertEqual(result.matched.length, 1);
    assertEqual(result.unmatchedGold.length, 1);
    assertEqual(result.unmatchedPred.length, 0);
  });

  it('prefers the higher-scoring pairing when candidates compete', () => {
    const result = matchSets(
      ['TypeScript', 'JavaScript'],
      ['JavaScript', 'TypeScript'],
      shortFieldSimilarity,
      0.85
    );
    assertEqual(result.matched.length, 2);
    for (const m of result.matched) {
      assertClose(m.score, 1, 1e-9, 'each should pair with its exact twin');
    }
  });
});
