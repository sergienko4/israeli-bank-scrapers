/**
 * Additional branch coverage tests for SelectorResolver.ts.
 * Targets: candidateToCss all kind branches, queryWithTimeout timer,
 * isPage check, extractCredentialKey fallback paths,
 * resolveFieldWithCache, resolveDashboardField.
 */
import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Scrapers/Base/Config/LoginConfig.js';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
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

const MOD = await import('../../Common/SelectorResolver.js');

describe('candidateToCss — all kind branches', () => {
  it('converts clickableText to xpath', () => {
    const result = MOD.candidateToCss({ kind: 'clickableText', value: 'Login' });
    expect(result).toContain('xpath=');
    expect(result).toContain('Login');
  });

  it('converts labelText to xpath label selector', () => {
    const result = MOD.candidateToCss({ kind: 'labelText', value: 'Username' });
    expect(result).toContain('xpath=//label');
    expect(result).toContain('Username');
  });

  it('converts css kind to raw CSS value', () => {
    const result = MOD.candidateToCss({ kind: 'css', value: '#myInput' });
    expect(result).toBe('#myInput');
  });

  it('converts placeholder to input[placeholder] selector', () => {
    const result = MOD.candidateToCss({ kind: 'placeholder', value: 'Enter ID' });
    expect(result).toBe('input[placeholder*="Enter ID"]');
  });

  it('converts ariaLabel to input[aria-label] selector', () => {
    const result = MOD.candidateToCss({ kind: 'ariaLabel', value: 'password' });
    expect(result).toBe('input[aria-label="password"]');
  });

  it('converts name to [name] selector', () => {
    const result = MOD.candidateToCss({ kind: 'name', value: 'userId' });
    expect(result).toBe('[name="userId"]');
  });

  it('converts xpath kind to xpath= prefixed selector', () => {
    const result = MOD.candidateToCss({
      kind: 'xpath',
      value: '//div[@id="test"]',
    } as SelectorCandidate);
    expect(result).toBe('xpath=//div[@id="test"]');
  });
});

describe('isPage — frame vs page detection', () => {
  it('returns true for page-like object with frames method', () => {
    const page = { frames: jest.fn().mockReturnValue([]) } as unknown as Page;
    const isPageResult = MOD.isPage(page);
    expect(isPageResult).toBe(true);
  });

  it('returns false for frame-like object without frames method', () => {
    const frame = { url: jest.fn().mockReturnValue('about:blank') } as unknown as Frame;
    const isPageResult = MOD.isPage(frame);
    expect(isPageResult).toBe(false);
  });
});

describe('extractCredentialKey — all branches', () => {
  it('extracts direct match from CSS ID selector', () => {
    const result = MOD.extractCredentialKey('#password');
    expect(result).toBe('password');
  });

  it('falls back to partial match via includes', () => {
    const result = MOD.extractCredentialKey('#userNameField');
    expect(result).toBe('username');
  });

  it('returns id for short id-prefixed keys', () => {
    const result = MOD.extractCredentialKey('#id1');
    expect(result).toBe('id');
  });

  it('returns raw id when no match found', () => {
    const result = MOD.extractCredentialKey('#xyzUnknownField');
    expect(result).toBe('xyzUnknownField');
  });

  it('handles non-ID selector without hash', () => {
    const result = MOD.extractCredentialKey('input.field');
    expect(result).toBe('input.field');
  });
});

describe('queryWithTimeout — element found/not found/timeout', () => {
  it('returns true when element is found', async () => {
    const ctx = {
      $: jest.fn().mockResolvedValue({ tagName: 'INPUT' }),
    } as unknown as Page;
    const wasFound = await MOD.queryWithTimeout(ctx, '#test');
    expect(wasFound).toBe(true);
  });

  it('returns false when element is null', async () => {
    const ctx = {
      $: jest.fn().mockResolvedValue(null),
    } as unknown as Page;
    const wasFound = await MOD.queryWithTimeout(ctx, '#missing');
    expect(wasFound).toBe(false);
  });

  it('returns false when query times out', async () => {
    const neverResolve = new Promise<null>(() => {
      /* intentionally never resolves */
    });
    const ctx = {
      $: jest.fn().mockReturnValue(neverResolve),
    } as unknown as Page;
    const wasFound = await MOD.queryWithTimeout(ctx, '#slow');
    expect(wasFound).toBe(false);
  }, 10000);
});

describe('tryInContext — first match wins', () => {
  it('returns empty string when no candidates match', async () => {
    const ctx = { $: jest.fn().mockResolvedValue(null) } as unknown as Page;
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#nonexistent' }];
    const result = await MOD.tryInContext(ctx, candidates);
    expect(result).toBe('');
  });

  it('returns first matching candidate CSS', async () => {
    const ctx = { $: jest.fn().mockResolvedValue({ tagName: 'INPUT' }) } as unknown as Page;
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#found' }];
    const result = await MOD.tryInContext(ctx, candidates);
    expect(result).toBe('#found');
  });
});

describe('toXpathLiteral — additional escaping', () => {
  it('handles empty string', () => {
    const result = MOD.toXpathLiteral('');
    expect(result).toBe('""');
  });

  it('wraps in double quotes when value has single quotes but no double quotes', () => {
    const result = MOD.toXpathLiteral("it's");
    expect(result).toBe('"it\'s"');
  });
});
