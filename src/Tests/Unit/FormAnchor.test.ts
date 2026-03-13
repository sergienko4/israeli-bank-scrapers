import { jest } from '@jest/globals';
import type { Page } from 'playwright';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const FORM_ANCHOR_MOD = await import('../../Common/FormAnchor.js');

// ── discoverFormAnchor ────────────────────────────────────────────────────

describe('discoverFormAnchor', () => {
  it('returns null when the resolved selector is not found', async () => {
    const page = { $: jest.fn().mockResolvedValue(null) } as unknown as Page;
    const result = await FORM_ANCHOR_MOD.discoverFormAnchor(page, '#missing');
    expect(result).toBeNull();
  });

  it('returns form anchor when inputHandle.evaluate finds a form with id', async () => {
    const inputHandle = { evaluate: jest.fn().mockResolvedValue('#loginForm') };
    const page = { $: jest.fn().mockResolvedValue(inputHandle) } as unknown as Page;
    const result = await FORM_ANCHOR_MOD.discoverFormAnchor(page, '#username');
    expect(result).not.toBeNull();
    expect(result?.selector).toBe('#loginForm');
    expect(result?.context).toBe(page);
  });

  it('returns null when evaluate returns null (no form found)', async () => {
    const inputHandle = { evaluate: jest.fn().mockResolvedValue(null) };
    const page = { $: jest.fn().mockResolvedValue(inputHandle) } as unknown as Page;
    const result = await FORM_ANCHOR_MOD.discoverFormAnchor(page, '#username');
    expect(result).toBeNull();
  });
});

// ── scopeCandidate ──────────────────────────────────────────────────────────

describe('scopeCandidate', () => {
  it('scopes CSS candidates with form descendant combinator', () => {
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', {
      kind: 'css',
      value: '.login-btn',
    });
    expect(result).toEqual({ kind: 'css', value: '#loginForm .login-btn' });
  });

  it('scopes placeholder candidates to form context', () => {
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', {
      kind: 'placeholder',
      value: 'סיסמה',
    });
    expect(result).toEqual({ kind: 'css', value: '#loginForm input[placeholder*="סיסמה"]' });
  });

  it('scopes ariaLabel candidates to form context', () => {
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', {
      kind: 'ariaLabel',
      value: 'שם משתמש',
    });
    expect(result).toEqual({ kind: 'css', value: '#loginForm input[aria-label="שם משתמש"]' });
  });

  it('scopes name candidates to form context', () => {
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', {
      kind: 'name',
      value: 'password',
    });
    expect(result).toEqual({ kind: 'css', value: '#loginForm [name="password"]' });
  });

  it('passes through labelText candidates unchanged (uses DOM traversal)', () => {
    const candidate = { kind: 'labelText' as const, value: 'סיסמה' };
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', candidate);
    expect(result).toBe(candidate);
  });

  it('passes through textContent candidates unchanged (uses DOM traversal)', () => {
    const candidate = { kind: 'textContent' as const, value: 'כניסה' };
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', candidate);
    expect(result).toBe(candidate);
  });

  it('passes through xpath candidates unchanged', () => {
    const candidate = { kind: 'xpath' as const, value: '//button[contains(., "כניסה")]' };
    const result = FORM_ANCHOR_MOD.scopeCandidate('#loginForm', candidate);
    expect(result).toBe(candidate);
  });
});

// ── scopeCandidates (array) ────────────────────────────────────────────────

describe('scopeCandidates', () => {
  it('scopes all scopable candidates and passes through others', () => {
    const candidates = [
      { kind: 'css' as const, value: '#btn' },
      { kind: 'labelText' as const, value: 'סיסמה' },
      { kind: 'placeholder' as const, value: 'שם' },
    ];
    const result = FORM_ANCHOR_MOD.scopeCandidates('form', candidates);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: 'css', value: 'form #btn' });
    expect(result[1]).toBe(candidates[1]);
    expect(result[2]).toEqual({ kind: 'css', value: 'form input[placeholder*="שם"]' });
  });
});
