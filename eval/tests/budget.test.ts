import { describe, it, assert, assertEqual, assertClose } from './harness';
import {
  CHARS_PER_TOKEN,
  estimateTokens,
  fitSections,
  promptCharBudget,
  truncateAtBoundary,
} from '../../src/lib/llm/budget';

describe('token budgeting', () => {
  it('leaves an under-budget prompt completely untouched', () => {
    const result = fitSections(
      [
        { label: 'a', value: 'short', weight: 1 },
        { label: 'b', value: 'also short', weight: 5 },
      ],
      10_000
    );
    assert(!result.anyTruncated, 'nothing should be truncated');
    assertEqual(result.sections.map((s) => s.value), ['short', 'also short']);
  });

  it('redistributes the allowance a short section does not use', () => {
    // Weights say 50/50, so a naive split gives each 100 chars and truncates the
    // long one at 100. The short section only needs 10, so the long one should end
    // up with ~190 instead. Without redistribution most of the budget is wasted.
    const long = 'x'.repeat(1000);
    const result = fitSections(
      [
        { label: 'short', value: 'y'.repeat(10), weight: 1 },
        { label: 'long', value: long, weight: 1 },
      ],
      200
    );
    const longSection = result.sections.find((s) => s.label === 'long')!;
    assert(longSection.keptChars > 150, `long section kept only ${longSection.keptChars} chars`);
    assertEqual(result.sections.find((s) => s.label === 'short')!.truncated, false);
  });

  it('never returns more characters than the budget allows', () => {
    // Regression: the truncation marker used to be appended *after* the cut, which
    // pushed the returned string back over the limit the budget existed to enforce.
    for (const budget of [40, 60, 120, 500]) {
      const result = fitSections([{ label: 'a', value: 'word '.repeat(500), weight: 1 }], budget);
      assert(
        result.totalChars <= budget,
        `budget ${budget} produced ${result.totalChars} chars`
      );
    }
  });

  it('drops a section entirely when its allowance cannot hold a marker plus content', () => {
    assertEqual(truncateAtBoundary('a'.repeat(100), 10), '');
  });

  it('normalises null and undefined rather than stringifying them', () => {
    // `String(null)` is "null", which would render into the prompt as literal text
    // and teach the model that missing values look like that.
    const result = fitSections(
      [
        { label: 'a', value: null, weight: 1 },
        { label: 'b', value: undefined, weight: 1 },
        { label: 'c', value: 'real', weight: 1 },
      ],
      100
    );
    assertEqual(result.sections.map((s) => s.value), ['', '', 'real']);
  });

  it('reports a zero budget when the reply reservation alone exceeds the ceiling', () => {
    const budget = promptCharBudget({ tpmLimit: 8000, replyTokens: 9000 });
    assertEqual(budget.charBudget, 0);
  });

  it('keeps prompt + reply under the TPM ceiling for an abusive input', () => {
    const tpmLimit = 8000;
    const replyTokens = 2500;
    const budget = promptCharBudget({ tpmLimit, replyTokens, fixedOverheadTokens: 400 });
    const fitted = fitSections(
      [
        { label: 'header', value: 'h'.repeat(50_000), weight: 6 },
        { label: 'body', value: 'b'.repeat(120_000), weight: 4 },
      ],
      budget.charBudget
    );
    const projected = estimateTokens(fitted.sections.map((s) => s.value).join('')) + replyTokens + 400;
    assert(projected < tpmLimit, `projected ${projected} tokens against a ${tpmLimit} ceiling`);
  });

  it('estimates tokens pessimistically', () => {
    // Deliberately below the ~4 chars/token of plain English: these prompts carry
    // JSON and OCR output, which tokenize denser. An optimistic estimate makes the
    // guard stop guarding.
    assert(CHARS_PER_TOKEN <= 3, 'chars-per-token must stay pessimistic');
    assertClose(estimateTokens('abcdef'), 2);
  });

  it('cuts at a word boundary rather than mid-token', () => {
    const out = truncateAtBoundary('alpha beta gamma delta epsilon zeta eta theta', 60);
    assert(!/\b(alph|bet|gamm)\b/.test(out), `cut mid-word: ${out}`);
  });
});
