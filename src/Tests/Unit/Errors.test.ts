import {
  createGenericError,
  createTimeoutError,
  createWafBlockedError,
  type ErrorResult,
  ScraperErrorTypes,
  WafBlockError,
} from '../../Scrapers/Base/Errors';

describe('ScraperErrorTypes', () => {
  it('has all expected error types', () => {
    expect(ScraperErrorTypes.TwoFactorRetrieverMissing).toBe('TWO_FACTOR_RETRIEVER_MISSING');
    expect(ScraperErrorTypes.InvalidPassword).toBe('INVALID_PASSWORD');
    expect(ScraperErrorTypes.ChangePassword).toBe('CHANGE_PASSWORD');
    expect(ScraperErrorTypes.Timeout).toBe('TIMEOUT');
    expect(ScraperErrorTypes.AccountBlocked).toBe('ACCOUNT_BLOCKED');
    expect(ScraperErrorTypes.Generic).toBe('GENERIC');
    expect(ScraperErrorTypes.Generic).toBe('GENERIC'); // General is a deprecated alias for backwards compat
    expect(ScraperErrorTypes.WafBlocked).toBe('WAF_BLOCKED');
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

describe('createWafBlockedError', () => {
  it('returns error result with WafBlocked type', () => {
    const result = createWafBlockedError('blocked by WAF');
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorMessage).toBe('blocked by WAF');
  });

  it('includes errorDetails when provided', () => {
    const details = {
      provider: 'cloudflare' as const,
      httpStatus: 403,
      pageTitle: 'רק רגע...',
      pageUrl: 'https://example.com',
      suggestions: ['Wait 1-2 hours'],
    };
    const result = createWafBlockedError('blocked', details);
    expect(result.errorDetails).toEqual(details);
  });
});

describe('WafBlockError', () => {
  it('creates error with structured details', () => {
    const error = WafBlockError.cloudflareBlock(403, 'רק רגע...', 'https://amex.co.il/login');
    expect(error.name).toBe('WafBlockError');
    expect(error.details.provider).toBe('cloudflare');
    expect(error.details.httpStatus).toBe(403);
    expect(error.details.pageTitle).toBe('רק רגע...');
    expect(error.details.suggestions.length).toBeGreaterThan(0);
    expect(error.message).toContain('WAF blocked by cloudflare');
  });

  it('cloudflareTurnstile includes Turnstile-specific suggestions', () => {
    const error = WafBlockError.cloudflareTurnstile('Just a moment...', 'https://amex.co.il/login');
    expect(error.details.provider).toBe('cloudflare');
    expect(error.details.httpStatus).toBe(403);
    expect(error.details.suggestions).toEqual(
      expect.arrayContaining([expect.stringContaining('Turnstile')]),
    );
  });

  it('apiBlock includes pageTitle and responseSnippet separately', () => {
    const error = WafBlockError.apiBlock(429, 'https://amex.co.il/api', {
      pageTitle: 'Login Page',
      responseSnippet: 'Block Automation response body',
    });
    expect(error.details.provider).toBe('unknown');
    expect(error.details.httpStatus).toBe(429);
    expect(error.details.pageTitle).toBe('Login Page');
    expect(error.details.responseSnippet).toBe('Block Automation response body');
  });

  it('apiBlock truncates long responseSnippet to 200 chars', () => {
    const longSnippet = 'x'.repeat(500);
    const error = WafBlockError.apiBlock(403, 'https://amex.co.il/api', {
      pageTitle: 'Page',
      responseSnippet: longSnippet,
    });
    expect(error.details.responseSnippet).toHaveLength(200);
  });

  it('apiBlock uses empty defaults when opts not provided', () => {
    const error = WafBlockError.apiBlock(403, 'https://example.com');
    expect(error.details.pageTitle).toBe('');
    expect(error.details.responseSnippet).toBeUndefined();
    expect(error.details.httpStatus).toBe(403);
  });
});
