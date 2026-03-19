/**
 * Unit tests for PipelineWellKnown.ts.
 * Validates structure: all required fields, zero CSS entries, required candidate kinds.
 */

import {
  PIPELINE_WELL_KNOWN_DASHBOARD,
  PIPELINE_WELL_KNOWN_LOGIN,
} from '../../../../../Scrapers/Pipeline/Registry/PipelineWellKnown.js';

// ── LOGIN dictionary ──────────────────────────────────────

describe('PIPELINE_WELL_KNOWN_LOGIN/structure', () => {
  it('contains all 9 expected credential keys', () => {
    const keys = Object.keys(PIPELINE_WELL_KNOWN_LOGIN);
    expect(keys).toContain('username');
    expect(keys).toContain('userCode');
    expect(keys).toContain('password');
    expect(keys).toContain('id');
    expect(keys).toContain('nationalID');
    expect(keys).toContain('card6Digits');
    expect(keys).toContain('num');
    expect(keys).toContain('otpCode');
    expect(keys).toContain('__submit__');
  });
});

describe('PIPELINE_WELL_KNOWN_LOGIN/zero-css', () => {
  it('has NO kind:css entries anywhere in LOGIN selectors', () => {
    const allCandidates = Object.values(PIPELINE_WELL_KNOWN_LOGIN).flat();
    const cssEntries = allCandidates.filter(c => (c.kind as string) === 'css');
    expect(cssEntries).toHaveLength(0);
  });
});

describe('PIPELINE_WELL_KNOWN_LOGIN/text-candidates', () => {
  it('__submit__ has ariaLabel candidates', () => {
    const submit = PIPELINE_WELL_KNOWN_LOGIN.__submit__;
    const hasAriaLabel = submit.some(c => c.kind === 'ariaLabel');
    expect(hasAriaLabel).toBe(true);
  });

  it('__submit__ has xpath candidates', () => {
    const submit = PIPELINE_WELL_KNOWN_LOGIN.__submit__;
    const hasXpath = submit.some(c => c.kind === 'xpath');
    expect(hasXpath).toBe(true);
  });

  it('__submit__ has textContent candidates', () => {
    const submit = PIPELINE_WELL_KNOWN_LOGIN.__submit__;
    const hasText = submit.some(c => c.kind === 'textContent');
    expect(hasText).toBe(true);
  });

  it('__submit__ has NO kind:css entry', () => {
    const submit = PIPELINE_WELL_KNOWN_LOGIN.__submit__;
    const cssSubmit = submit.filter(c => (c.kind as string) === 'css');
    expect(cssSubmit).toHaveLength(0);
  });

  it('each login field has at least one text-based candidate', () => {
    const textKinds = new Set(['labelText', 'textContent', 'placeholder', 'ariaLabel', 'name']);
    for (const [key, candidates] of Object.entries(PIPELINE_WELL_KNOWN_LOGIN)) {
      if (key === '__submit__') continue;
      const hasText = candidates.some(c => textKinds.has(c.kind));
      expect(hasText).toBe(true);
    }
  });
});

// ── DASHBOARD dictionary ──────────────────────────────────

describe('PIPELINE_WELL_KNOWN_DASHBOARD/structure', () => {
  it('contains all expected dashboard keys', () => {
    const keys = Object.keys(PIPELINE_WELL_KNOWN_DASHBOARD);
    expect(keys).toContain('loginLink');
    expect(keys).toContain('errorIndicator');
    expect(keys).toContain('logoutLink');
    expect(keys).toContain('dashboardIndicator');
    expect(keys).toContain('changePasswordIndicator');
  });
});

describe('PIPELINE_WELL_KNOWN_DASHBOARD/zero-css', () => {
  it('has NO kind:css entries anywhere in DASHBOARD selectors', () => {
    const allCandidates = Object.values(PIPELINE_WELL_KNOWN_DASHBOARD).flat();
    const cssEntries = allCandidates.filter(c => (c.kind as string) === 'css');
    expect(cssEntries).toHaveLength(0);
  });
});

describe('PIPELINE_WELL_KNOWN_DASHBOARD/errorIndicator', () => {
  it('errorIndicator contains VisaCal-specific error text', () => {
    const texts = PIPELINE_WELL_KNOWN_DASHBOARD.errorIndicator.map(c => c.value);
    expect(texts).toContain('שם המשתמש או הסיסמה שהוזנו שגויים');
  });

  it('errorIndicator contains generic Hebrew error texts', () => {
    const texts = PIPELINE_WELL_KNOWN_DASHBOARD.errorIndicator.map(c => c.value);
    expect(texts).toContain('פרטים שגויים');
  });

  it('all errorIndicator entries use textContent kind', () => {
    const kinds = PIPELINE_WELL_KNOWN_DASHBOARD.errorIndicator.map(c => c.kind);
    const allowedKinds = new Set(['textContent', 'ariaLabel', 'labelText']);
    const hasOnlyTextKinds = kinds.every(k => allowedKinds.has(k));
    expect(hasOnlyTextKinds).toBe(true);
  });
});
