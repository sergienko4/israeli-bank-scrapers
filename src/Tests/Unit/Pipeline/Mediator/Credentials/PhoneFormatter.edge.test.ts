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

/** Realistic Israeli mobile digits in international form. */
const VALID_DIGITS = '972542155100';

describe('formatPhoneNumber — strict validation branches', () => {
  it('rejects strings shorter than the minimum 10 digits', () => {
    const result = formatPhoneNumber('97254', 'international-plus');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('expected ≥10 digits');
  });

  it('rejects strings carrying non-digit characters', () => {
    const result = formatPhoneNumber('+972-542-15-5100', 'international-plus');
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
    if (result.success) expect(result.value).toBe('542155100');
  });

  it('produces the dash-separated wire form for PayBox-style banks', () => {
    const format: PhoneNumberFormat = 'international-dash';
    const result = formatPhoneNumber(VALID_DIGITS, format);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('972-542155100');
  });
});
