import {
  createChangePasswordError,
  createGenericError,
  createTimeoutError,
  type IErrorResult,
  ScraperErrorTypes,
} from '../Helpers/Errors.js';

describe('ScraperErrorTypes', () => {
  it('has all expected error types', () => {
    expect(ScraperErrorTypes.TwoFactorRetrieverMissing).toBe('TWO_FACTOR_RETRIEVER_MISSING');
    expect(ScraperErrorTypes.InvalidPassword).toBe('INVALID_PASSWORD');
    expect(ScraperErrorTypes.ChangePassword).toBe('CHANGE_PASSWORD');
    expect(ScraperErrorTypes.Timeout).toBe('TIMEOUT');
    expect(ScraperErrorTypes.AccountBlocked).toBe('ACCOUNT_BLOCKED');
    expect(ScraperErrorTypes.Generic).toBe('GENERIC');
    expect(ScraperErrorTypes.WafBlocked).toBe('WAF_BLOCKED');
  });
});

describe('createTimeoutError', () => {
  it('returns error result with Timeout type', () => {
    const result: IErrorResult = createTimeoutError('operation timed out');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    expect(result.errorMessage).toBe('operation timed out');
  });
});

describe('createGenericError', () => {
  it('returns error result with Generic type', () => {
    const result: IErrorResult = createGenericError('something went wrong');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('something went wrong');
  });
});

describe('createChangePasswordError', () => {
  it('returns error result with ChangePassword type', () => {
    const result: IErrorResult = createChangePasswordError('password change required');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
    expect(result.errorMessage).toBe('password change required');
  });
});
