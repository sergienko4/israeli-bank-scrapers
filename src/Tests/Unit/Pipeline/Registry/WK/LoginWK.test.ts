/**
 * LoginWK — pin the login-form field matchers against live bank UIs.
 * Regression guard: Yahav's nationalID field (#pinno) carries its label
 * ONLY in `aria-label` ("תעודת זהות (9 ספרות)") with an empty placeholder,
 * so the legacy→pipeline migration that dropped the `ariaLabel` + name/id
 * matchers silently broke login — nationalID resolved NOT_FOUND, fell back
 * to #username, and collided with num. These cases pin the matchers so the
 * drop cannot recur.
 */

import { WK_LOGIN_FORM } from '../../../../../Scrapers/Pipeline/Registry/WK/LoginWK.js';

/** A WK form-slot entry shape (just the bits this test asserts on). */
interface IFormEntry {
  readonly kind: string;
  readonly value: string;
}

/**
 * Whether the nationalId slot carries a (kind, value) matcher.
 * @param kind - WK selector kind ("ariaLabel", "xpath", …).
 * @param value - Literal selector value.
 * @returns True iff present.
 */
function hasNationalId(kind: string, value: string): boolean {
  return WK_LOGIN_FORM.nationalId.some(
    (entry: IFormEntry): boolean => entry.kind === kind && entry.value === value,
  );
}

describe('WK_LOGIN_FORM.nationalId — aria-label-only field coverage', () => {
  it('matches by aria-label "תעודת זהות" (Yahav empty-placeholder field)', () => {
    const isMatched = hasNationalId('ariaLabel', 'תעודת זהות');
    expect(isMatched).toBe(true);
  });

  it('matches by name="NATIONAL_ID"', () => {
    const isMatched = hasNationalId('xpath', '//input[@name="NATIONAL_ID"]');
    expect(isMatched).toBe(true);
  });

  it('matches Yahav id="pinno"', () => {
    const isMatched = hasNationalId('xpath', '//input[@id="pinno"]');
    expect(isMatched).toBe(true);
  });
});
