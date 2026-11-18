/**
 * Boundary validation through the public scraper: invalid options and
 * credentials fail before the enricher or a bank request.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import PipelineScraper from '../../../../Scrapers/Pipeline/Core/PipelineScraper.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import createScraper from '../../../../Scrapers/Registry/Factory.js';

const START = new Date('2026-01-01');
const ALL_BANKS = Object.values(CompanyTypes);

/**
 * Build options for one bank.
 * @param companyId - Bank under test.
 * @param overrides - Option values to replace.
 * @returns Scraper options.
 */
function options(companyId: CompanyTypes, overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return { companyId, startDate: START, ...overrides };
}

describe('PipelineScraper boundary — options', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(() => Promise.reject(new Error('fetch must not run')));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(ALL_BANKS)('rejects an invalid start date for %s before fetch', async companyId => {
    const opts = options(companyId, { startDate: new Date(Number.NaN) });
    const scraper = createScraper(opts);
    const result = await scraper.scrape({} as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'startDate must be a valid date',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range future window before fetch', async () => {
    const opts = options(CompanyTypes.Leumi, { futureMonthsToScrape: 25 });
    const scraper = createScraper(opts);
    const result = await scraper.scrape({ username: 'u', password: 'p' });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'futureMonthsToScrape must be an integer between 0 and 24',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PipelineScraper boundary — required credentials', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(() => Promise.reject(new Error('fetch must not run')));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    [CompanyTypes.OneZero, {}, 'email'],
    [CompanyTypes.PayBox, { password: 'p' }, 'phoneNumber'],
    [CompanyTypes.Pepper, { phoneNumber: '050' }, 'password'],
    [CompanyTypes.Isracard, { id: '123', password: 'p' }, 'card6Digits'],
    [CompanyTypes.Amex, { id: '123', card6Digits: '123456' }, 'password'],
  ] as const)('rejects missing %s credentials', async (companyId, credentials, field) => {
    const opts = options(companyId);
    const scraper = createScraper(opts);
    const result = await scraper.scrape(credentials as ScraperCredentials);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    const message = result.errorMessage ?? '';
    expect(message).toContain('Missing or malformed credentials:');
    if (field.length > 0) expect(message).toContain(field);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PipelineScraper boundary — enrichment order', () => {
  it('does not enrich credentials the boundary rejects', async () => {
    const enrich = jest.fn((credentials: ScraperCredentials) => succeed(credentials));
    const descriptor: IPipelineDescriptor = {
      options: options(CompanyTypes.Leumi),
      phases: [],
      credentialPolicy: { requiredCreds: { username: 'nonEmpty' } },
      enrichCredentials: enrich,
    };
    const scraper = new PipelineScraper(descriptor.options, () => succeed(descriptor));
    const result = await scraper.scrape({ password: 'p' } as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'Missing or malformed credentials: username',
    });
    expect(enrich).not.toHaveBeenCalled();
  });
});
