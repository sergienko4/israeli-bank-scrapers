/**
 * WK_CLOSE_POPUP — pin Bank Leumi's cookie-consent close control.
 *
 * Source of truth (captured live 2026-06 from www.leumi.co.il/he, no login):
 *   <button aria-label="כפתור סגירה חלון cookies">× \n\n  סגירה</button>
 * The home page renders a dimming overlay until this control is dismissed,
 * which blocked the HOME phase from clicking the login link.
 *
 * This test reproduces the bug (the legacy text-only candidates cannot match
 * that button) and locks the fix (the `ariaLabel` candidate does). The
 * authoritative match is Playwright `getByRole('button', { name, exact:false })`
 * — see Elements/Create/Locators.ts `buildAriaLabelLocators`; here we mirror
 * those documented semantics so the contract is verifiable without a browser.
 */

import { WK_CLOSE_POPUP } from '../../../../../Scrapers/Pipeline/Registry/WK/SharedWK.js';

/** A WK close-popup candidate shape (only the bits this test asserts on). */
interface ICloseCandidate {
  readonly kind: string;
  readonly value: string;
}

/** The real Leumi cookie-close button, captured live (see file header). */
const LEUMI_COOKIE_BUTTON = {
  accessibleName: 'כפתור סגירה חלון cookies',
  textContent: '× \n\n  סגירה',
} as const;

/** The close word ("closing") registered to dismiss the Leumi overlay. */
const LEUMI_CLOSE_VALUE = 'סגירה';

/**
 * Mirror the documented `exactText` semantics: Playwright `getByText(value,
 * { exact: true })` matches when the element's normalized text equals value.
 * Modelled conservatively against the whole button text (so it returns false
 * here — the real inner-text-node match is proven at the Mode A / E2E level).
 * @param value - Candidate literal.
 * @param text - Element's text content.
 * @returns True iff an exact (whitespace-normalized) text match.
 */
function exactTextMatches(value: string, text: string): boolean {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  return normalized === value;
}

/**
 * Mirror the documented `ariaLabel` semantics: fans out to
 * getByRole(..., { name, exact: false }) — case-insensitive substring of the
 * accessible name.
 * @param value - Candidate literal.
 * @param name - Element's accessible name.
 * @returns True iff value is a case-insensitive substring of name.
 */
function ariaLabelMatches(value: string, name: string): boolean {
  const haystack = name.toLowerCase();
  const needle = value.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Whether a single candidate would resolve the Leumi cookie button under the
 * documented matching semantics for its kind.
 * @param candidate - WK close-popup candidate.
 * @returns True iff this candidate matches the captured button.
 */
function candidateMatchesLeumiCookie(candidate: ICloseCandidate): boolean {
  if (candidate.kind === 'exactText') {
    return exactTextMatches(candidate.value, LEUMI_COOKIE_BUTTON.textContent);
  }
  if (candidate.kind === 'ariaLabel') {
    return ariaLabelMatches(candidate.value, LEUMI_COOKIE_BUTTON.accessibleName);
  }
  return false;
}

/**
 * Whether the registry holds a candidate of the given kind + value.
 * @param kind - Candidate kind.
 * @param value - Candidate literal.
 * @returns True iff present.
 */
function hasCandidate(kind: string, value: string): boolean {
  return WK_CLOSE_POPUP.some((c: ICloseCandidate): boolean => c.kind === kind && c.value === value);
}

describe('WK_CLOSE_POPUP — Bank Leumi cookie-consent overlay', () => {
  it('registers the Leumi close word as ariaLabel + exactText', () => {
    const hasAria = hasCandidate('ariaLabel', LEUMI_CLOSE_VALUE);
    const hasExact = hasCandidate('exactText', LEUMI_CLOSE_VALUE);
    expect(hasAria).toBe(true);
    expect(hasExact).toBe(true);
  });

  it('matches the captured cookie button via at least one candidate', () => {
    const hasAnyMatch = WK_CLOSE_POPUP.some(candidateMatchesLeumiCookie);
    expect(hasAnyMatch).toBe(true);
  });

  it('the pre-existing candidates alone could NOT match it (the bug)', () => {
    const legacy = WK_CLOSE_POPUP.filter(
      (c: ICloseCandidate): boolean => c.value !== LEUMI_CLOSE_VALUE,
    );
    const hasAnyLegacyMatch = legacy.some(candidateMatchesLeumiCookie);
    expect(hasAnyLegacyMatch).toBe(false);
  });
});
