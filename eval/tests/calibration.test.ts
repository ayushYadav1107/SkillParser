import { describe, it, assert, assertEqual, assertClose } from './harness';
import { auroc, computeCalibration, routingCurve, type CalibrationPoint } from '../metrics/calibration';

const point = (confidence: number, correct: boolean, field = 'skills'): CalibrationPoint => ({
  confidence,
  correct,
  field,
});

describe('calibration', () => {
  it('reports near-zero error for a perfectly calibrated model', () => {
    // 80% of the 0.8-confidence predictions are right, 100% of the 1.0 ones.
    const points = [
      ...Array.from({ length: 8 }, () => point(0.8, true)),
      ...Array.from({ length: 2 }, () => point(0.8, false)),
      ...Array.from({ length: 10 }, () => point(0.95, true)),
    ];
    const report = computeCalibration(points, 0);
    assert(report.ece < 0.06, `ECE should be small, got ${report.ece}`);
  });

  it('detects overconfidence', () => {
    const points = [
      ...Array.from({ length: 5 }, () => point(0.95, true)),
      ...Array.from({ length: 5 }, () => point(0.95, false)),
    ];
    const report = computeCalibration(points, 0);
    assert(report.overconfident, 'mean confidence 0.95 against 0.5 accuracy');
    assertClose(report.accuracy, 0.5);
    assert(report.ece > 0.4, `ECE should be large, got ${report.ece}`);
  });

  it('puts confidence exactly 1.0 in the top bin rather than dropping it', () => {
    const report = computeCalibration([point(1, true), point(1, false)], 0);
    assertEqual(report.scored, 2);
    assertEqual(report.bins[report.bins.length - 1].count, 2);
  });

  it('separates discrimination from calibration', () => {
    // Badly calibrated (everything is scored near 0.9) but perfectly discriminating:
    // every correct prediction is ranked above every wrong one. This model's numbers
    // are useless as probabilities and perfectly good for routing.
    const points = [
      point(0.92, true), point(0.93, true), point(0.94, true),
      point(0.89, false), point(0.88, false), point(0.87, false),
    ];
    const report = computeCalibration(points, 0);
    assertClose(report.auroc, 1, 1e-9);
    assert(report.ece > 0.3, 'poorly calibrated despite perfect ranking');
  });

  it('gives ties their average rank instead of an arbitrary order', () => {
    // Models cluster confidence on round numbers, so ties are the common case.
    assertClose(auroc([point(0.9, true), point(0.9, false)]), 0.5);
  });

  it('returns 0.5 when every outcome is the same', () => {
    assertClose(auroc([point(0.9, true), point(0.5, true)]), 0.5);
  });

  it('counts unreported confidence rather than imputing a default', () => {
    const report = computeCalibration([point(0.9, true)], 42);
    assertEqual(report.unreported, 42);
    assertEqual(report.scored, 1);
  });

  it('breaks calibration down by field without recursing forever', () => {
    // Regression: the per-field breakdown used to call back into the top-level
    // function, which recomputed its own per-field breakdown, and so on.
    const report = computeCalibration(
      [point(0.9, true, 'skills'), point(0.4, false, 'personal.email')],
      0
    );
    assertEqual(Object.keys(report.byField).sort(), ['personal.email', 'skills']);
  });

  it('produces a routing curve where a higher threshold accepts less and errs less', () => {
    const points = [
      point(0.99, true), point(0.98, true), point(0.6, false), point(0.4, false),
    ];
    const curve = routingCurve(points, [0.5, 0.9]);
    const low = curve[0];
    const high = curve[1];
    assert(high.autoAcceptRate < low.autoAcceptRate, 'stricter threshold accepts fewer');
    assert(high.autoAcceptAccuracy >= low.autoAcceptAccuracy, 'stricter threshold errs less');
    assertClose(high.errorsCaught, 1);
  });
});
