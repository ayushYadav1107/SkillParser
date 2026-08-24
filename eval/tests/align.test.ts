import { describe, it, assert, assertEqual } from './harness';
import { alignEntries, maximumWeightAssignment, type AlignableEntry } from '../metrics/align';

const role = (organization: string, label: string, date: string, body = ''): AlignableEntry => ({
  organization,
  label,
  date,
  body,
});

describe('entry alignment', () => {
  it('matches entries the model returned in the opposite order', () => {
    // Positional comparison would score this near zero. A model that reads three
    // roles perfectly but emits them oldest-first has not made a mistake.
    const gold = [
      role('Halcyon Grid Systems', 'Staff Engineer', 'Jan 2023 - Present'),
      role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022'),
    ];
    const predicted = [gold[1], gold[0]];
    const alignment = alignEntries(gold, predicted);
    assertEqual(alignment.pairs.length, 2);
    assertEqual(alignment.pairs.find((p) => p.goldIndex === 0)?.predIndex, 1);
    assertEqual(alignment.unmatchedGold.length, 0);
  });

  it('does not mismatch two roles at the same employer', () => {
    // The promotion case. A greedy matcher can consume the wrong pair first and
    // cascade; the exact assignment cannot.
    const gold = [
      role('Quintaline Systems', 'Principal Reliability Engineer', 'Mar 2022 - Present'),
      role('Quintaline Systems', 'Reliability Engineer', 'Aug 2019 - Mar 2022'),
    ];
    const predicted = [
      role('Quintaline Systems', 'Reliability Engineer', 'Aug 2019 - Mar 2022'),
      role('Quintaline Systems', 'Principal Reliability Engineer', 'Mar 2022 - Present'),
    ];
    const alignment = alignEntries(gold, predicted);
    assertEqual(alignment.pairs.length, 2);
    assertEqual(alignment.pairs.find((p) => p.goldIndex === 0)?.predIndex, 1);
    assertEqual(alignment.pairs.find((p) => p.goldIndex === 1)?.predIndex, 0);
  });

  it('reports a missed entry rather than forcing a bad match', () => {
    const gold = [
      role('Halcyon Grid Systems', 'Staff Engineer', 'Jan 2023 - Present'),
      role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022'),
    ];
    const alignment = alignEntries(gold, [gold[0]]);
    assertEqual(alignment.pairs.length, 1);
    assertEqual(alignment.unmatchedGold, [1]);
  });

  it('detects a split when one role is emitted as two entries', () => {
    const gold = [
      role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022', 'Shipped the ingest pipeline.'),
    ];
    const predicted = [
      role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022', 'Shipped the ingest pipeline.'),
      role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022', 'Shipped the ingest pipeline.'),
    ];
    const alignment = alignEntries(gold, predicted);
    assertEqual(alignment.pairs.length, 1);
    assertEqual(alignment.splits.length, 1);
    assertEqual(alignment.splits[0].goldIndex, 0);
  });

  it('detects a merge when two roles collapse into one', () => {
    const gold = [
      role('Quintaline Systems', 'Principal Engineer', 'Mar 2022 - Present'),
      role('Quintaline Systems', 'Principal Engineer', 'Aug 2019 - Mar 2022'),
    ];
    const alignment = alignEntries(gold, [gold[0]]);
    assertEqual(alignment.pairs.length, 1);
    assertEqual(alignment.merges.length, 1);
  });

  it('marks a wholly invented entry as unmatched rather than as a split', () => {
    const gold = [role('Umbra Robotics', 'Backend Engineer', 'Jun 2020 - Dec 2022')];
    const predicted = [gold[0], role('Ferrite Cloud', 'Chief Executive', '1998 - 1999')];
    const alignment = alignEntries(gold, predicted);
    assertEqual(alignment.unmatchedPred, [1]);
    assertEqual(alignment.splits.length, 0);
  });

  it('handles empty lists on either side', () => {
    assertEqual(alignEntries([], []).pairs.length, 0);
    assertEqual(alignEntries([role('a', 'b', 'c')], []).unmatchedGold, [0]);
    assertEqual(alignEntries([], [role('a', 'b', 'c')]).unmatchedPred, [0]);
  });

  it('finds the optimal assignment where greedy would not', () => {
    // Greedy takes 0.9 at (0,0) and is then forced to 0.1 at (1,1) for 1.0 total.
    // The optimum is (0,1) + (1,0) = 0.8 + 0.85 = 1.65.
    const score = [
      [0.9, 0.8],
      [0.85, 0.1],
    ];
    assertEqual(maximumWeightAssignment(score), [1, 0]);
  });

  it('leaves a row unassigned when every column would lower the total', () => {
    const assignment = maximumWeightAssignment([[0.5], [0.9]]);
    assertEqual(assignment[1], 0);
    assertEqual(assignment[0], -1);
  });
});
