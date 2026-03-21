import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../../../../Scrapers/Base/Interface.js';
import type { IWafErrorDetails } from '../../../../Scrapers/Base/Interfaces/WafErrorDetails.js';
import {
  fail,
  failWithDetails,
  fromLegacy,
  isOk,
  succeed,
  toLegacy,
} from '../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('Procedure/succeed', () => {
  it('creates IProcedureSuccess with ok=true', () => {
    const result = succeed('data');
    expect(result.success).toBe(true);
    expect(result.value).toBe('data');
  });

  it('preserves generic type for objects', () => {
    const obj = { accounts: [] };
    const result = succeed(obj);
    expect(result.success).toBe(true);
    expect(result.value).toBe(obj);
  });

  it('wraps empty object as success', () => {
    const result = succeed({});
    expect(result.success).toBe(true);
    expect(result.value).toEqual({});
  });
});

describe('Procedure/fail', () => {
  it('creates IProcedureFailure with ok=false', () => {
    const result = fail(ScraperErrorTypes.InvalidPassword, 'wrong password');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(result.errorMessage).toBe('wrong password');
  });

  it('sets errorDetails to none()', () => {
    const result = fail(ScraperErrorTypes.Generic, 'error');
    expect(result.errorDetails.has).toBe(false);
  });

  it('works with every ScraperErrorTypes value', () => {
    const types = Object.values(ScraperErrorTypes);
    for (const errorType of types) {
      const result = fail(errorType, `test ${errorType}`);
      expect(result.success).toBe(false);
      expect(result.errorType).toBe(errorType);
    }
  });

  it('preserves empty error message', () => {
    const result = fail(ScraperErrorTypes.Generic, '');
    expect(result.errorMessage).toBe('');
  });
});

describe('Procedure/failWithDetails', () => {
  it('creates failure with WAF error details', () => {
    const details: IWafErrorDetails = {
      provider: 'cloudflare',
      httpStatus: 403,
      pageTitle: 'Blocked',
      pageUrl: 'https://bank.co.il',
      suggestions: ['wait'],
    };
    const result = failWithDetails(ScraperErrorTypes.WafBlocked, 'blocked', details);
    expect(result.success).toBe(false);
    expect(result.errorDetails.has).toBe(true);
    if (result.errorDetails.has) {
      expect(result.errorDetails.value.provider).toBe('cloudflare');
      expect(result.errorDetails.value.httpStatus).toBe(403);
    }
  });
});

describe('Procedure/isOk', () => {
  it('returns true for succeed', () => {
    const result = succeed('val');
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('returns false for fail', () => {
    const result = fail(ScraperErrorTypes.Timeout, 'timeout');
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('narrows type to access value', () => {
    const result = succeed(42);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });
});

describe('Procedure/fromLegacy', () => {
  it('converts success IScraperScrapingResult to IProcedureSuccess', () => {
    const legacy: IScraperScrapingResult = { success: true };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.success).toBe(true);
    }
  });

  it('converts failure IScraperScrapingResult to IProcedureFailure', () => {
    const legacy: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'bad creds',
    };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
      expect(result.errorMessage).toBe('bad creds');
    }
  });

  it('defaults missing errorType to Generic', () => {
    const legacy: IScraperScrapingResult = { success: false };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    }
  });

  it('defaults missing errorMessage to Unknown error', () => {
    const legacy: IScraperScrapingResult = { success: false };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toBe('Unknown error');
    }
  });

  it('wraps errorDetails when present', () => {
    const details: IWafErrorDetails = {
      provider: 'unknown',
      httpStatus: 503,
      pageTitle: 'Service Unavailable',
      pageUrl: 'https://example.com',
      suggestions: [],
    };
    const legacy: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
      errorMessage: 'waf',
      errorDetails: details,
    };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorDetails.has).toBe(true);
    }
  });

  it('sets errorDetails to none when absent', () => {
    const legacy: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'err',
    };
    const result = fromLegacy(legacy);
    expect(result.success).toBe(false);
    if (!isOk(result)) {
      expect(result.errorDetails.has).toBe(false);
    }
  });
});

describe('Procedure/toLegacy', () => {
  it('converts success Procedure to { success: true }', () => {
    const proc = succeed({ data: 'test' });
    const legacy = toLegacy(proc);
    expect(legacy.success).toBe(true);
  });

  it('converts failure Procedure to IScraperScrapingResult', () => {
    const proc = fail(ScraperErrorTypes.Timeout, 'timed out');
    const legacy = toLegacy(proc);
    expect(legacy.success).toBe(false);
    expect(legacy.errorType).toBe(ScraperErrorTypes.Timeout);
    expect(legacy.errorMessage).toBe('timed out');
  });

  it('includes errorDetails in legacy when present', () => {
    const details: IWafErrorDetails = {
      provider: 'cloudflare',
      httpStatus: 429,
      pageTitle: 'Rate Limited',
      pageUrl: 'https://bank.co.il',
      suggestions: [],
    };
    const proc = failWithDetails(ScraperErrorTypes.WafBlocked, 'waf', details);
    const legacy = toLegacy(proc);
    expect(legacy.errorDetails).toBeDefined();
    expect(legacy.errorDetails?.provider).toBe('cloudflare');
  });

  it('omits errorDetails from legacy when absent', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'err');
    const legacy = toLegacy(proc);
    expect(legacy.errorDetails).toBeUndefined();
  });

  it('round-trips: toLegacy(fromLegacy(x)) preserves shape', () => {
    const original: IScraperScrapingResult = {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'wrong',
    };
    const converted = fromLegacy(original);
    const roundTripped = toLegacy(converted);
    expect(roundTripped.success).toBe(original.success);
    expect(roundTripped.errorType).toBe(original.errorType);
    expect(roundTripped.errorMessage).toBe(original.errorMessage);
  });
});
