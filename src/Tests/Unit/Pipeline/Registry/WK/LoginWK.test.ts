/**
 * LoginWK — pin the login-form field matchers against live bank UIs.
 * Regression guard: Yahav's nationalID field (#pinno) carries its label
 * ONLY in `aria-label` ("תעודת זהות (9 ספרות)") with an empty placeholder,
 * so the legacy→pipeline migration that dropped the visible-text matchers
 * silently broke login — nationalID resolved NOT_FOUND, fell back to
 * #username, and collided with num. These cases pin the visible-text
 * (labelText / ariaLabel) matchers — which resolve via Playwright
 * `getByLabel` (substring accessible-name match) — and assert the slot
 * stays free of structural (name/id) CSS coupling, so neither the drop nor
 * a CSS-coupling regression can recur.
 */

import { WK_LOGIN_FORM } from '../../../../../Scrapers/Pipeline/Registry/WK/LoginWK.js';

/** A WK form-slot entry shape (just the bits this test asserts on). */
interface IFormEntry {
  readonly kind: string;
  readonly value: string;
}

/** Selector kinds that couple to DOM structure (name/id/class) — forbidden. */
const STRUCTURAL_KINDS = ['xpath', 'css', 'name'];

/**
 * Whether the nationalId slot carries a (kind, value) matcher.
 * @param kind - WK selector kind ("ariaLabel", "labelText", …).
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

  it('matches by labelText "תעודת זהות" (getByLabel substring)', () => {
    const isMatched = hasNationalId('labelText', 'תעודת זהות');
    expect(isMatched).toBe(true);
  });

  it('uses only visible-text matchers — no name/id CSS coupling', () => {
    const structural = WK_LOGIN_FORM.nationalId.filter((entry: IFormEntry): boolean =>
      STRUCTURAL_KINDS.includes(entry.kind),
    );
    expect(structural).toHaveLength(0);
  });
});
