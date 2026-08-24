import { describe, it, assert } from './harness';
import { fewShotExemplarText } from '../../src/lib/llm/prompts';
import {
  COMPANIES,
  DEGREES,
  DISCIPLINES,
  FAMILY_NAMES,
  GIVEN_NAMES,
  INSTITUTIONS,
} from '../corpus/pools';

describe('prompt / corpus contamination', () => {
  it('shares no names, employers or institutions between the exemplars and the corpus', () => {
    // If the few-shot worked examples drew on the same pools as the evaluation
    // corpus, the few-shot arm would score higher for reasons that have nothing to
    // do with few-shot prompting, and the comparison would be measuring leakage.
    const exemplars = fewShotExemplarText().toLowerCase();
    const leaked: string[] = [];
    const pools: Array<[string, readonly string[]]> = [
      ['given name', GIVEN_NAMES],
      ['family name', FAMILY_NAMES],
      ['company', COMPANIES],
      ['institution', INSTITUTIONS],
      ['degree', DEGREES],
    ];
    for (const [kind, pool] of pools) {
      for (const value of pool) {
        if (value.length < 4) continue;
        if (exemplars.includes(value.toLowerCase())) leaked.push(`${kind}: ${value}`);
      }
    }
    assert(leaked.length === 0, `corpus values found in the few-shot exemplars:\n  ${leaked.join('\n  ')}`);
  });

  it('does not reuse corpus achievement text in the exemplars', () => {
    const exemplars = fewShotExemplarText().toLowerCase();
    const leaked = DISCIPLINES.flatMap((d) => d.achievements).filter((a) =>
      exemplars.includes(a.slice(0, 40).toLowerCase())
    );
    assert(leaked.length === 0, `achievement text leaked: ${leaked[0] ?? ''}`);
  });

  it('still teaches the schema shape it is supposed to teach', () => {
    // The disjointness above would be trivially satisfied by empty exemplars.
    const exemplars = fewShotExemplarText();
    for (const key of ['personal', 'skills', 'experience', 'education', 'certifications', 'confidence']) {
      assert(exemplars.includes(key), `exemplars no longer demonstrate "${key}"`);
    }
  });
});
