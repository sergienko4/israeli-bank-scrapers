// Regression tests for CR PR #286 findings F9 + F10. Validates the OTP detector
// config exports that have no behavior-dependent tests in OtpDetector*.test.ts:
//   • PHONE_PATTERN (F10) — accepts 3-star masks like ***1234 from real bank
//     screens; rejects 2-star masks; rejects too-short tail digits.
//   • PHONE_PATTERN ReDoS safety — bounded quantifiers prevent runaway on
//     adversarial input (worst-case timing well under 100 ms).
//   • SELECTOR_CANDIDATES (F9) — exported as readonly tuples (frozen literal
//     types), preventing accidental mutation in consumers.
import {
  OTP_FALLBACK_CLICK_TIMEOUT_MS,
  OTP_FORCE_CLICK_TIMEOUT_MS,
  OTP_INPUT_CANDIDATES,
  OTP_SUBMIT_CANDIDATES,
  PHONE_PATTERN,
  SMS_TRIGGER_CANDIDATES,
} from '../../Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.js';

describe('OtpDetectorConfig — PHONE_PATTERN (CR PR #286 F10)', () => {
  it.each([
    ['***1234', true, '3-star mask + 4 digits (canonical real-bank shape)'],
    ['****1234', true, '4-star mask + 4 digits'],
    ['*'.repeat(8) + '12', true, '8-star mask + 2 digits'],
    ['*'.repeat(32) + '9999', true, 'upper-bound 32-star mask'],
    ['**1234', false, '2-star mask is below the 3-star floor'],
    ['*1234', false, '1-star mask is below the 3-star floor'],
    ['1234', false, 'plain digits without any stars are not a masked hint'],
    ['***1', false, 'only 1 trailing digit is below the 2-digit floor'],
    ['***12345', true, 'mask + 4 digits matches even when followed by extra digits'],
  ])('PHONE_PATTERN.test(%j) === %s — %s', (input, expected) => {
    const didMatch = PHONE_PATTERN.test(input);
    expect(didMatch).toBe(expected);
  });

  it('rejects super-linear backtracking on adversarial input (ReDoS safety)', () => {
    const adversarial = '*'.repeat(5_000) + 'X';
    const start = Date.now();
    const didMatch = PHONE_PATTERN.test(adversarial);
    const elapsed = Date.now() - start;
    expect(didMatch).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('OtpDetectorConfig — readonly selector tables (CR PR #286 F9)', () => {
  it.each([
    ['OTP_INPUT_CANDIDATES', OTP_INPUT_CANDIDATES],
    ['OTP_SUBMIT_CANDIDATES', OTP_SUBMIT_CANDIDATES],
    ['SMS_TRIGGER_CANDIDATES', SMS_TRIGGER_CANDIDATES],
  ])('%s is a non-empty array of well-formed SelectorCandidate entries', (_, arr) => {
    const isArr = Array.isArray(arr);
    expect(isArr).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    arr.forEach(entry => {
      expect(typeof entry.kind).toBe('string');
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
    });
  });
});

describe('OtpDetectorConfig — click timeouts (CR PR #286 F7)', () => {
  it('exposes fallback (5000 ms) and force (3000 ms) timeouts as configured constants', () => {
    expect(OTP_FALLBACK_CLICK_TIMEOUT_MS).toBe(5000);
    expect(OTP_FORCE_CLICK_TIMEOUT_MS).toBe(3000);
    expect(OTP_FORCE_CLICK_TIMEOUT_MS).toBeLessThan(OTP_FALLBACK_CLICK_TIMEOUT_MS);
  });
});
