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
import { MAX_ENCODED_CHARS } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthEnvelope.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import createScraper from '../../../../Scrapers/Registry/Factory.js';
import { makeJwtExpiringInWithClaims } from '../../../Helpers/Jwt.js';
import { makeStoredState } from '../Mediator/ApiDirectCall/Flow/DurableAuthFixtures.js';

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

/** One invalid-option case for the boundary table. */
interface IInvalidOptionCase {
  readonly label: string;
  readonly companyId: CompanyTypes;
  readonly overrides: Partial<ScraperOptions>;
  readonly message: string;
}

/** Invalid option cases: one date per bank plus an out-of-range window. */
const INVALID_OPTION_CASES: readonly IInvalidOptionCase[] = [
  ...ALL_BANKS.map(companyId => ({
    label: `${companyId} invalid start date`,
    companyId,
    overrides: { startDate: new Date(Number.NaN) },
    message: 'startDate must be a valid date',
  })),
  {
    label: 'Leumi out-of-range future window',
    companyId: CompanyTypes.Leumi,
    overrides: { futureMonthsToScrape: 25 },
    message: 'futureMonthsToScrape must be an integer between 0 and 24',
  },
];

describe('PipelineScraper boundary', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<
    ReturnType<typeof globalThis.fetch>,
    Parameters<typeof globalThis.fetch>
  >;

  beforeEach(() => {
    fetchMock = jest.fn<ReturnType<typeof globalThis.fetch>, Parameters<typeof globalThis.fetch>>(
      () => Promise.reject(new Error('fetch must not run')),
    );
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(INVALID_OPTION_CASES)('rejects $label before fetch', async (row: IInvalidOptionCase) => {
    const opts = options(row.companyId, row.overrides);
    const scraper = createScraper(opts);
    const result = await scraper.scrape({} as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: row.message,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a null persistent auth state before fetch', async () => {
    const opts = options(CompanyTypes.Leumi, {
      persistentAuthState: null as unknown as string,
    });
    const scraper = createScraper(opts);
    const result = await scraper.scrape({ username: 'u', password: 'p' });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'persistentAuthState must be a string',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [CompanyTypes.OneZero, {}, 'email'],
    [CompanyTypes.PayBox, {}, 'phoneNumber'],
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
    expect(message).toContain(field);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-object credential bag before fetch', async () => {
    const opts = options(CompanyTypes.Leumi);
    const scraper = createScraper(opts);
    const result = await scraper.scrape(null as unknown as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'credentials must be an object',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not enrich credentials the boundary rejects', async () => {
    const opts = options(CompanyTypes.Leumi);
    const enrich = jest.fn((credentials: ScraperCredentials) => succeed(credentials));
    const descriptor: IPipelineDescriptor = {
      options: opts,
      phases: [],
      credentialPolicy: { requiredCreds: { username: 'nonEmpty' } },
      enrichCredentials: enrich,
    };
    const scraper = new PipelineScraper(opts, () => succeed(descriptor));
    const result = await scraper.scrape({ password: 'p' } as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'Missing or malformed credentials: username',
    });
    expect(enrich).not.toHaveBeenCalled();
  });

  it('validates and executes a snapshot of the caller options', async () => {
    const opts = options(CompanyTypes.Leumi);
    const originalStart = opts.startDate;
    const build = jest.fn((snapshot: ScraperOptions) => {
      opts.startDate = new Date('2030-01-01T00:00:00.000Z');
      return succeed({ options: snapshot, phases: [] });
    });
    const scraper = new PipelineScraper(opts, build);
    const result = await scraper.scrape({ username: 'u', password: 'p' });
    expect(result.success).toBe(true);
    const snapshot = build.mock.calls[0][0];
    const snapshotTime = snapshot.startDate.getTime();
    const originalTime = originalStart.getTime();
    expect(snapshot.startDate).not.toBe(originalStart);
    expect(snapshotTime).toBe(originalTime);
  });

  it('accepts a codec-published Pepper state above 16 KiB', async () => {
    const token = makeJwtExpiringInWithClaims(3600, { pad: 'x'.repeat(12_000) });
    const { encoded } = makeStoredState(token);
    expect(encoded.length).toBeGreaterThan(16_384);
    expect(encoded.length).toBeLessThanOrEqual(MAX_ENCODED_CHARS);
    const opts = options(CompanyTypes.Pepper, { persistentAuthState: encoded });
    const descriptor: IPipelineDescriptor = { options: opts, phases: [] };
    const scraper = new PipelineScraper(opts, () => succeed(descriptor));
    const result = await scraper.scrape({
      phoneNumber: '050',
      password: 'p',
    } as ScraperCredentials);
    expect(result.success).toBe(true);
  });
});
