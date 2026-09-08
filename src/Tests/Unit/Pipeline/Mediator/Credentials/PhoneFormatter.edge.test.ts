/**
 * Edge-case unit tests for {@link formatPhoneNumber}.
 *
 * The happy paths are covered end-to-end by
 * `PhoneNormalisation.integration.test.ts`. This file pins the strict
 * validation branches (too short / non-digit / wrong country code /
 * local-only format) per test-guidlines.md "unit test for edge cases
 * only" — these failure modes wouldn't naturally be reached by the
 * full pipeline integration path without polluting it with malformed
 * fixtures.
 */

import {
  formatPhoneNumber,
  type PhoneNumberFormat,
} from '../../../../../Scrapers/Pipeline/Mediator/Credentials/PhoneFormatter.js';

/** Placeholder-digit international-form phone for fixtures (Rule #18 PII-free). */
const VALID_DIGITS = '972000000000';

describe('formatPhoneNumber — strict validation branches', () => {
  it('rejects strings shorter than the minimum 10 digits', () => {
    const result = formatPhoneNumber('97254', 'international-plus');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('expected ≥10 digits');
  });

  it('rejects strings carrying non-digit characters', () => {
    const result = formatPhoneNumber('+972-000-00-0000', 'international-plus');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('digits-only');
  });

  it('rejects digits that do not start with the IL country code', () => {
    const result = formatPhoneNumber('1234567890', 'international-plus');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('country code 972');
  });

  it('produces the local-only wire form on the reserved format tag', () => {
    const format: PhoneNumberFormat = 'local-only';
    const result = formatPhoneNumber(VALID_DIGITS, format);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('000000000');
  });

  it('produces the dash-separated wire form for PayBox-style banks', () => {
    const format: PhoneNumberFormat = 'international-dash';
    const result = formatPhoneNumber(VALID_DIGITS, format);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('972-000000000');
  });
});

/**
 * Idempotence branch — `docs/banks/onezero.md` and `docs/banks/paybox.md`
 * document the bank's own wire form as the value to pass, so a caller
 * following those guides supplies a string that is already normalised.
 * Normalising it again must be a no-op rather than a hard failure.
 * The strictness pins below prove this is an exact round-trip and not a
 * blanket "anything decorated is fine" escape hatch.
 */
describe('formatPhoneNumber — idempotence on the bank wire form', () => {
  it('accepts a value already in the plus wire form documented for OneZero', () => {
    const result = formatPhoneNumber('+972000000000', 'international-plus');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('+972000000000');
  });

  it('accepts a value already in the dash wire form documented for PayBox', () => {
    const result = formatPhoneNumber('972-000000000', 'international-dash');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('972-000000000');
  });

  it('rejects a decorated value that is not the exact wire form of its bank', () => {
    const result = formatPhoneNumber('972-000-000-000', 'international-dash');
    expect(result.success).toBe(false);
  });

  it('rejects a wire form belonging to a different bank than the one declared', () => {
    const result = formatPhoneNumber('+972000000000', 'international-dash');
    expect(result.success).toBe(false);
  });

  it('still rejects the Israeli local trunk form on a flat-format bank', () => {
    const result = formatPhoneNumber('0500000001', 'international-flat');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('country code 972');
  });
});
