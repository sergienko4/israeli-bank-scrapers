import { ScraperErrorTypes, createTimeoutError, createGenericError, type ErrorResult } from './errors';

describe('ScraperErrorTypes', () => {
  it('has all expected error types', () => {
    expect(ScraperErrorTypes.TwoFactorRetrieverMissing).toBe('TWO_FACTOR_RETRIEVER_MISSING');
    expect(ScraperErrorTypes.InvalidPassword).toBe('INVALID_PASSWORD');
    expect(ScraperErrorTypes.ChangePassword).toBe('CHANGE_PASSWORD');
    expect(ScraperErrorTypes.Timeout).toBe('TIMEOUT');
    expect(ScraperErrorTypes.AccountBlocked).toBe('ACCOUNT_BLOCKED');
    expect(ScraperErrorTypes.Generic).toBe('GENERIC');
    expect(ScraperErrorTypes.General).toBe('GENERAL_ERROR');
  });
});

describe('createTimeoutError', () => {
  it('returns error result with Timeout type', () => {
    const result: ErrorResult = createTimeoutError('operation timed out');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    expect(result.errorMessage).toBe('operation timed out');
  });
});

describe('createGenericError', () => {
  it('returns error result with Generic type', () => {
    const result: ErrorResult = createGenericError('something went wrong');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('something went wrong');
  });
});
