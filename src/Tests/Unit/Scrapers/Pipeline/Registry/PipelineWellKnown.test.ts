/**
 * Unit tests for PipelineWellKnown.ts.
 * Validates the nested WK phase structure: all required fields, zero CSS entries.
 */

import { WK } from '../../../../../Scrapers/Pipeline/Registry/PipelineWellKnown.js';

// ── WK.LOGIN.ACTION.FORM ────────────────────────────────────

describe('WK.LOGIN.ACTION.FORM/structure', () => {
  it('contains exactly the expected credential + control keys', () => {
    const keys = Object.keys(WK.LOGIN.ACTION.FORM);
    const sortedKeys = [...keys].sort((a, b) => a.localeCompare(b));
    const expected = ['id', 'mfa', 'num', 'otpArea', 'password', 'submit'].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(sortedKeys).toEqual(expected);
  });
});

describe('WK.LOGIN.ACTION.FORM/zero-css', () => {
  it('has NO kind:css entries anywhere in FORM selectors', () => {
    const allCandidates = Object.values(WK.LOGIN.ACTION.FORM).flat();
    const cssEntries = allCandidates.filter(c => (c.kind as string) === 'css');
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
      const submit = WK.LOGIN.ACTION.FORM.submit;
      const hasKind = submit.some(c => c.kind === kind);
      expect(hasKind).toBe(true);
    },
  );

  it('submit has NO kind:css entry', () => {
    const submit = WK.LOGIN.ACTION.FORM.submit;
    const cssSubmit = submit.filter(c => (c.kind as string) === 'css');
    expect(cssSubmit).toHaveLength(0);
  });

  it('each credential field has at least one text-based candidate', () => {
    const textKinds = new Set(['labelText', 'textContent', 'placeholder', 'ariaLabel', 'name']);
    for (const [key, candidates] of Object.entries(WK.LOGIN.ACTION.FORM)) {
      if (key === 'submit' || key === 'otpArea') continue;
      const hasText = candidates.some(c => textKinds.has(c.kind));
      expect(hasText).toBe(true);
    }
  });
});

// ── WK.DASHBOARD ──────────────────────────────────────────────

describe('WK.DASHBOARD/structure', () => {
  it('contains post-auth UI helper keys', () => {
    const keys = Object.keys(WK.DASHBOARD);
    expect(keys).toContain('ERROR');
    expect(keys).toContain('CHANGE_PWD');
    expect(keys).toContain('LOADING');
  });
});

describe('WK.DASHBOARD/zero-css', () => {
  it('has NO kind:css entries anywhere in DASHBOARD selectors', () => {
    const allCandidates = Object.values(WK.DASHBOARD).flat();
    const cssEntries = allCandidates.filter(c => (c.kind as string) === 'css');
    expect(cssEntries).toHaveLength(0);
  });
});

describe('WK.DASHBOARD.ERROR', () => {
  it('ERROR contains VisaCal-specific error text', () => {
    const texts = WK.DASHBOARD.ERROR.map(c => c.value);
    expect(texts).toContain('שם המשתמש או הסיסמה שהוזנו שגויים');
  });

  it('ERROR contains generic Hebrew error texts', () => {
    const texts = WK.DASHBOARD.ERROR.map(c => c.value);
    expect(texts).toContain('פרטים שגויים');
  });
});
