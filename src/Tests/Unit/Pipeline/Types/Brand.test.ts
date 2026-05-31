/**
 * Unit tests for Types/Brand — verify each mint helper returns the same
 * primitive value (zero-cost cast). Coverage closes the 10/10 statement
 * gap on Brand.ts so the pipeline coverage threshold (97/95/96/98) holds.
 */

import {
  mintAccountId,
  mintAccountIndex,
  mintBankId,
  mintBankSlug,
  mintDidSucceed,
  mintDurationMs,
  mintEnvelopeErrorCode,
  mintPhaseStepLabel,
  mintSafeUrlForLog,
  mintShouldStop,
} from '../../../../Scrapers/Pipeline/Types/Brand.js';

describe('Brand mint helpers', () => {
  it('mintAccountId preserves the underlying string value', () => {
    const accountId = mintAccountId('1234567890');
    expect(accountId).toBe('1234567890');
  });

  it('mintBankId preserves the underlying string value', () => {
    const bankId = mintBankId('discount');
    expect(bankId).toBe('discount');
  });

  it('mintSafeUrlForLog preserves the underlying string value', () => {
    const safeUrl = mintSafeUrlForLog('https://example.com/path');
    expect(safeUrl).toBe('https://example.com/path');
  });

  it('mintEnvelopeErrorCode preserves the underlying string value', () => {
    const code = mintEnvelopeErrorCode('0');
    expect(code).toBe('0');
  });

  it('mintAccountIndex preserves the underlying number value', () => {
    const zero = mintAccountIndex(0);
    const seven = mintAccountIndex(7);
    expect(zero).toBe(0);
    expect(seven).toBe(7);
  });

  it('mintDurationMs preserves the underlying number value', () => {
    const ms = mintDurationMs(1500);
    expect(ms).toBe(1500);
  });

  it('mintDidSucceed preserves the underlying boolean value', () => {
    const yes = mintDidSucceed(true);
    const no = mintDidSucceed(false);
    expect(yes).toBe(true);
    expect(no).toBe(false);
  });

  it('mintShouldStop preserves the underlying boolean value', () => {
    const stop = mintShouldStop(true);
    const cont = mintShouldStop(false);
    expect(stop).toBe(true);
    expect(cont).toBe(false);
  });

  it('mintBankSlug preserves the underlying string value', () => {
    const slug = mintBankSlug('pepper');
    expect(slug).toBe('pepper');
  });

  it('mintPhaseStepLabel preserves the underlying string value', () => {
    const label = mintPhaseStepLabel('login-pre-done');
    expect(label).toBe('login-pre-done');
  });
});
