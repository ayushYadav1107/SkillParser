import { describe, it, assert, assertEqual } from './harness';
import {
  dateIntervalsMatch,
  isDateFormatOnlyDifference,
  normalizeOrganization,
  normalizePhone,
  normalizeText,
  parseDateInterval,
} from '../metrics/normalize';

describe('normalisation', () => {
  it('treats the same interval written four ways as the same interval', () => {
    const forms = ['Jan 2020 - Dec 2022', 'January 2020 – December 2022', '01/2020 — 12/2022'];
    for (const a of forms) {
      for (const b of forms) {
        assert(dateIntervalsMatch(a, b), `${a} should match ${b}`);
      }
    }
  });

  it('compares by year when only one side records a month', () => {
    // A resume that literally says "2021 - 2023" has no month to extract. Demanding
    // one would penalise a correct reading of an imprecise source.
    assert(dateIntervalsMatch('2020 - 2022', 'Jan 2020 - Dec 2022'), 'year-only should match');
  });

  it('does not match intervals that differ by a year', () => {
    assert(!dateIntervalsMatch('Jan 2020 - Dec 2022', 'Jan 2020 - Dec 2023'), 'years differ');
  });

  it('recognises all the spellings of an open-ended role', () => {
    for (const word of ['Present', 'present', 'Current', 'now']) {
      assert(dateIntervalsMatch('Mar 2019 - Present', `Mar 2019 - ${word}`), word);
    }
  });

  it('does not treat an open end as equal to a closed one', () => {
    assert(!dateIntervalsMatch('Mar 2019 - Present', 'Mar 2019 - Mar 2024'), 'present ≠ a date');
  });

  it('flags a format-only difference separately from a wrong date', () => {
    assert(isDateFormatOnlyDifference('Jan 2020 - Dec 2022', '01/2020 - 12/2022'), 'format only');
    assert(!isDateFormatOnlyDifference('Jan 2020 - Dec 2022', 'Jan 2020 - Dec 2022'), 'identical');
    assert(!isDateFormatOnlyDifference('Jan 2020 - Dec 2022', 'Jan 2021 - Dec 2022'), 'wrong year');
  });

  it('handles an expected graduation date', () => {
    const parsed = parseDateInterval('Expected June 2027');
    assertEqual(parsed?.end?.year, 2027);
    assertEqual(parsed?.end?.month, 6);
  });

  it('matches phone numbers that differ only by country code', () => {
    assertEqual(normalizePhone('+1 (476) 008-8414'), normalizePhone('476-008-8414'));
    assert(normalizePhone('+91 74097 09968') !== normalizePhone('+91 74097 09967'), 'different numbers');
  });

  it('ignores legal suffixes on company names', () => {
    assertEqual(normalizeOrganization('Boreal Instrument Co.'), normalizeOrganization('Boreal Instrument'));
    assertEqual(normalizeOrganization('NorthPeak Logistics GmbH'), 'northpeak logistics');
  });

  it('does not reduce a company name to nothing when it is only a suffix', () => {
    assert(normalizeOrganization('Group').length > 0, 'must not empty out');
  });

  it('strips diacritics and normalises dashes and quotes', () => {
    assertEqual(normalizeText('Ó SÚILLEABHÁIN'), 'o suilleabhain');
    assertEqual(normalizeText('2020–2022'), '2020-2022');
  });
});
