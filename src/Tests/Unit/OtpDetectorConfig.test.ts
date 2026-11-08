// Tests for the OTP phone-hint constants shared by the OtpFill / OtpTrigger
// frame-scan extractors:
//   • PHONE_HINT_PATTERN — accepts 3-7 star masks like ***1234 from real bank
//     screens; rejects 2-star masks and masks wider than 7 stars.
//   • PHONE_HINT_PATTERN token boundaries — prevents partial matches inside a
//     longer masked value (e.g. ***12345 does NOT yield ***1234).
//   • PHONE_HINT_PATTERN ReDoS safety — bounded quantifiers prevent runaway on
//     adversarial input (worst-case timing well under 100 ms).
//   • PHONE_LAST_DIGITS — pulls the trailing 1-4 digits out of a matched hint.
import {
  PHONE_HINT_PATTERN,
  PHONE_LAST_DIGITS,
} from '../../Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.js';

describe('OtpDetectorConfig — PHONE_HINT_PATTERN', () => {
  it.each([
    ['***1234', true, '3-star mask + 4 digits (canonical real-bank shape)'],
    ['****1234', true, '4-star mask + 4 digits'],
    ['*'.repeat(7) + '12', true, 'upper-bound 7-star mask'],
    ['***1', true, 'a single trailing digit is accepted'],
    ['**1234', false, '2-star mask is below the 3-star floor'],
    ['*1234', false, '1-star mask is below the 3-star floor'],
    ['1234', false, 'plain digits without any stars are not a masked hint'],
    ['*'.repeat(8) + '1234', false, '8-star mask is above the 7-star ceiling'],
    // Token boundaries (no partial matches inside longer masked values)
    ['***12345', false, '5 trailing digits — partial match prevented'],
    ['***123456', false, '6 trailing digits — partial match prevented'],
    ['1***1234', false, 'leading digit context — partial match prevented'],
    ['****12345', false, '4-star mask + 5 digits — partial match prevented'],
    // Valid boundary contexts (non-digit/non-star delimiters)
    ['call ***1234 now', true, 'space-delimited mask + 4 digits in sentence'],
    ['-***1234', true, 'dash-prefixed mask is still valid'],
    ['***1234.', true, 'trailing punctuation does not block match'],
  ])('PHONE_HINT_PATTERN.test(%j) === %s — %s', (input, expected) => {
    const didMatch = PHONE_HINT_PATTERN.test(input);
    expect(didMatch).toBe(expected);
  });

  it('extracts the canonical mask (not a truncated prefix) from longer text', () => {
    const text = 'Code sent to ******5100 — please enter it below';
    const result = PHONE_HINT_PATTERN.exec(text);
    expect(result?.[0]).toBe('******5100');
  });

  it('returns null (not a truncated prefix) when text has too many trailing digits', () => {
    const text = 'Reference: ***12345 is too long to be a 4-digit mask';
    const result = PHONE_HINT_PATTERN.exec(text);
    expect(result).toBeNull();
  });

  it('rejects super-linear backtracking on adversarial input (ReDoS safety)', () => {
    const adversarial = '*'.repeat(5_000) + 'X';
    const start = Date.now();
    const didMatch = PHONE_HINT_PATTERN.test(adversarial);
    const elapsed = Date.now() - start;
    expect(didMatch).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('OtpDetectorConfig — PHONE_LAST_DIGITS', () => {
  it.each([
    ['***1234', '1234'],
    ['******5100', '5100'],
    ['***1', '1'],
  ])('extracts the trailing digits of %j as %j', (hint, expected) => {
    const result = PHONE_LAST_DIGITS.exec(hint);
    expect(result?.[1]).toBe(expected);
  });
});
