import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { fail, isOk, succeed, toLegacy } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('Procedure/succeed', () => {
  it('creates IProcedureSuccess with success=true', () => {
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
  it('creates IProcedureFailure with success=false', () => {
    const result = fail(ScraperErrorTypes.InvalidPassword, 'wrong password');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(result.errorMessage).toBe('wrong password');
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

  it('keeps an unreadable auth status as a legacy message marker', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'response body unreadable', 401);
    const legacy = toLegacy(proc);
    expect(legacy.errorMessage).toBe('response body unreadable HTTP 401');
  });

  it('does not duplicate an existing transport auth marker', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST /x 401: denied', 401);
    const legacy = toLegacy(proc);
    expect(legacy.errorMessage).toBe('POST /x 401: denied');
  });
});
