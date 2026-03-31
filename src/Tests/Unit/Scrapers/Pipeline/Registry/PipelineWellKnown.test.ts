/**
 * Unit tests for PipelineWellKnown.ts.
 * Validates structure: all required fields, zero CSS entries, required candidate kinds.
 */

import { WK_DASHBOARD } from '../../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';
import { WK_LOGIN_FORM } from '../../../../../Scrapers/Pipeline/Registry/WK/LoginWK.js';

/** Whether a WK test predicate matches. */
type WkMatch = boolean;
/** Extracted WK candidate value for assertion. */
type WkValue = string;

// ── LOGIN FORM dictionary ────────────────────────────────

describe('WK.LOGIN.ACTION.FORM/structure', () => {
  it('contains exactly the expected semantic form slots', () => {
    const keys = Object.keys(WK_LOGIN_FORM).sort();
    expect(keys).toEqual(['id', 'mfa', 'num', 'otpArea', 'password', 'submit']);
  });
});

describe('WK.LOGIN.ACTION.FORM/zero-css', () => {
  it('has NO kind:css entries anywhere in LOGIN FORM selectors', () => {
    const allCandidates = Object.values(WK_LOGIN_FORM).flat();
    /**
     * Check if a candidate uses CSS kind.
     * @param c - Selector candidate.
     * @returns True if kind is CSS.
     */
    const isCss = (c: (typeof allCandidates)[number]): WkMatch => (c.kind as string) === 'css';
    const cssEntries = allCandidates.filter(isCss);
    expect(cssEntries).toHaveLength(0);
  });
});

describe('WK.LOGIN.ACTION.FORM/text-candidates', () => {
  it.each(['ariaLabel', 'xpath', 'textContent'] as const)(
    /**
     * Verify submit includes each expected candidate kind.
     * @param kind - The expected SelectorCandidate kind.
     */
    'submit has %s candidates',
    kind => {
      const submit = WK_LOGIN_FORM.submit;
      /**
       * Check if a candidate matches the expected kind.
       * @param c - Selector candidate.
       * @returns True if candidate matches kind.
       */
      const matchesKind = (c: (typeof submit)[number]): WkMatch => c.kind === kind;
      const hasKind = submit.some(matchesKind);
      expect(hasKind).toBe(true);
    },
  );

  it('submit has NO kind:css entry', () => {
    const submit = WK_LOGIN_FORM.submit;
    /**
     * Check if a candidate uses CSS kind.
     * @param c - Selector candidate.
     * @returns True if kind is CSS.
     */
    const isCss = (c: (typeof submit)[number]): WkMatch => (c.kind as string) === 'css';
    const cssSubmit = submit.filter(isCss);
    expect(cssSubmit).toHaveLength(0);
  });

  it('each login field has at least one text-based candidate', () => {
    const textKinds = new Set(['labelText', 'textContent', 'placeholder', 'ariaLabel', 'name']);
    for (const [key, candidates] of Object.entries(WK_LOGIN_FORM)) {
      if (key === 'submit') continue;
      /**
       * Check if a candidate uses a text-based kind.
       * @param c - Selector candidate with kind field.
       * @param c.kind - The selector kind to check.
       * @returns True if candidate uses a text-based kind.
       */
      const isText = (c: { kind: string }): WkMatch => textKinds.has(c.kind);
      const hasText = candidates.some(isText);
      expect(hasText).toBe(true);
    }
  });
});

// ── DASHBOARD dictionary ─────────────────────────────────

describe('WK.DASHBOARD/structure', () => {
  it('contains all expected dashboard keys', () => {
    const keys = Object.keys(WK_DASHBOARD);
    expect(keys).toContain('ERROR');
    expect(keys).toContain('ACCOUNT');
    expect(keys).toContain('CHANGE_PWD');
    expect(keys).toContain('TRANSACTIONS');
    expect(keys).toContain('SKIP');
    expect(keys).toContain('BALANCE');
  });
});

describe('WK.DASHBOARD/zero-css', () => {
  it('has NO kind:css entries anywhere in DASHBOARD selectors', () => {
    const allValues = Object.values(WK_DASHBOARD).flat();
    /**
     * Filter to only selector candidates (objects with kind property).
     * @param c - Candidate or plain string (VALIDATION_HINTS are strings).
     * @returns True if c is a selector candidate object.
     */
    const isCandidate = (c: unknown): c is { kind: string } =>
      typeof c === 'object' && c !== null && 'kind' in c;
    const allCandidates = allValues.filter(isCandidate) as { kind: string }[];
    const cssEntries = allCandidates.filter((c): WkMatch => c.kind === 'css');
    expect(cssEntries).toHaveLength(0);
  });
});

describe('WK.DASHBOARD/ERROR', () => {
  it('ERROR contains VisaCal-specific error text', () => {
    /**
     * Extract value from candidate.
     * @param c - Selector candidate.
     * @returns Candidate value string.
     */
    const toValue = (c: (typeof WK_DASHBOARD.ERROR)[number]): WkValue => c.value;
    const texts = WK_DASHBOARD.ERROR.map(toValue);
    expect(texts).toContain('שם המשתמש או הסיסמה שהוזנו שגויים');
  });

  it('ERROR contains generic Hebrew error texts', () => {
    /**
     * Extract value from candidate.
     * @param c - Selector candidate.
     * @returns Candidate value string.
     */
    const toValue = (c: (typeof WK_DASHBOARD.ERROR)[number]): WkValue => c.value;
    const texts = WK_DASHBOARD.ERROR.map(toValue);
    expect(texts).toContain('פרטים שגויים');
  });

  it('all ERROR entries use text-based kinds (no CSS)', () => {
    /**
     * Extract kind from candidate.
     * @param c - Selector candidate.
     * @returns Candidate kind string.
     */
    const toKind = (c: (typeof WK_DASHBOARD.ERROR)[number]): WkValue => c.kind;
    const kinds = WK_DASHBOARD.ERROR.map(toKind);
    const allowedKinds = new Set(['textContent', 'ariaLabel', 'labelText']);
    /**
     * Check if kind is in allowed set.
     * @param k - Kind string.
     * @returns True if kind is allowed.
     */
    const isAllowed = (k: string): WkMatch => allowedKinds.has(k);
    const hasOnlyTextKinds = kinds.every(isAllowed);
    expect(hasOnlyTextKinds).toBe(true);
  });
});
