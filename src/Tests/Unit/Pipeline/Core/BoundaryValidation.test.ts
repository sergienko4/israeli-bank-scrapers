/**
 * Boundary validation — options and credentials fail before enrichment or a
 * bank request, with stable PII-free messages.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import validateBoundary from '../../../../Scrapers/Pipeline/Core/BoundaryValidation.js';

const START = new Date('2026-01-01');

/**
 * Build valid options.
 * @param overrides - Option values to replace.
 * @returns Scraper options.
 */
function options(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.Leumi,
    startDate: START,
    ...overrides,
  };
}

/** Valid ordinary credentials. */
const CREDS = { username: 'user', password: 'pass' } as ScraperCredentials;

/** The optional bank policy argument. */
type Policy = Parameters<typeof validateBoundary>[2];

/**
 * Validate one case.
 * @param overrides - Option values to replace.
 * @param creds - Credentials to validate.
 * @param policy - Bank-declared required credentials.
 * @returns Validation result.
 */
function check(
  overrides: Partial<ScraperOptions> = {},
  creds: ScraperCredentials = CREDS,
  policy?: Policy,
): ReturnType<typeof validateBoundary> {
  const opts = options(overrides);
  return validateBoundary(opts, creds, policy);
}

describe('validateBoundary — startDate', () => {
  it('accepts a finite Date', () => {
    const result = check();
    expect(result.success).toBe(true);
  });

  it.each([
    ['a NaN date', new Date(Number.NaN)],
    ['a non-Date value', '2026-01-01'],
  ])('refuses %s', (_label, startDate) => {
    const result = check({ startDate: startDate as Date });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'startDate must be a valid date',
    });
  });
});

describe('validateBoundary — futureMonthsToScrape', () => {
  it.each([0, 24])('accepts the bound %s', futureMonthsToScrape => {
    const result = check({ futureMonthsToScrape });
    expect(result.success).toBe(true);
  });

  it.each([-1, 25, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s',
    futureMonthsToScrape => {
      const result = check({ futureMonthsToScrape });
      expect(result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: 'futureMonthsToScrape must be an integer between 0 and 24',
      });
    },
  );
});

describe('validateBoundary — required credentials', () => {
  const policy = { requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' } } as const;

  it('names missing fields without their values', () => {
    const result = check({}, { username: ' ', password: 'secret' }, policy);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'Missing or malformed credentials: username',
    });
    expect(result.success ? '' : result.errorMessage).not.toContain('secret');
  });

  it('passes when every required field is sound', () => {
    const result = check({}, CREDS, policy);
    expect(result.success).toBe(true);
  });
});

describe('validateBoundary — credential lengths', () => {
  it('accepts an ordinary credential at the 256-character cap', () => {
    const result = check({}, { username: 'a'.repeat(256), password: 'p' });
    expect(result.success).toBe(true);
  });

  it('refuses an ordinary credential over 256 characters', () => {
    const result = check({}, { username: 'a'.repeat(257), password: 'p' });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'username exceeds 256 characters',
    });
  });

  it('accepts a device signature at its own cap', () => {
    const creds = { userCode: 'u', password: 'p', deviceSignature: 'd'.repeat(8192) };
    const result = check({}, creds);
    expect(result.success).toBe(true);
  });

  it('refuses a device signature over its cap', () => {
    const creds = { userCode: 'u', password: 'p', deviceSignature: 'd'.repeat(8193) };
    const result = check({}, creds);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'deviceSignature exceeds 8192 characters',
    });
  });

  it('accepts a long-term token at its own cap', () => {
    const creds = { username: 'u', password: 'p', otpLongTermToken: 't'.repeat(16_384) };
    const result = check({}, creds);
    expect(result.success).toBe(true);
  });

  it('refuses a long-term token over its cap', () => {
    const creds = { username: 'u', password: 'p', otpLongTermToken: 't'.repeat(16_385) };
    const result = check({}, creds);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'otpLongTermToken exceeds 16384 characters',
    });
  });

  it('refuses persistent auth state over its cap', () => {
    const result = check({ persistentAuthState: 's'.repeat(16_385) });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'persistentAuthState exceeds 16384 characters',
    });
  });
});

describe('validateBoundary — credential shape', () => {
  it('refuses a null credential bag without throwing', () => {
    const result = check({}, null as unknown as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'credentials must be an object',
    });
  });
});
