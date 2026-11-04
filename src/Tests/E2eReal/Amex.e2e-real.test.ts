import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { INVALID_CREDS_ISRACARD_AMEX } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.AMEX_ID &&
  process.env.AMEX_CARD6DIGITS &&
  process.env.AMEX_PASSWORD
);

/**
 * Amex logs in over the issuer's mobile gateway and opens no browser. A
 * cold login (ID, card digits, password) registers a device key and returns
 * it on `persistentOtpToken`; a warm login signs in with that key alone. The
 * key does not rotate, so a warm run hands the same key back. No step sends
 * an SMS, so a rejected key costs nothing: the pipeline falls back to the
 * cold login by itself. The mocked suite pins which login steps ran; this
 * suite proves the real bank accepts both.
 */
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

/** Amex's password credentials. */
interface IAmexPasswordCreds {
  readonly id: string;
  readonly card6Digits: string;
  readonly password: string;
}

/**
 * Run one Amex scrape with a fresh scraper.
 * @param creds - Cold or warm credentials.
 * @returns The scrape result.
 */
function scrapeAmex(creds: ScraperCredentials): Promise<IScraperScrapingResult> {
  const scraper = createScraper({
    companyId: CompanyTypes.Amex,
    startDate: defaultStartDate(),
  });
  return scraper.scrape(creds);
}

/**
 * Read the password credentials from the environment.
 * @returns Cold credentials.
 */
function coldCreds(): IAmexPasswordCreds {
  const id = process.env.AMEX_ID ?? '';
  const card6Digits = process.env.AMEX_CARD6DIGITS ?? '';
  const password = process.env.AMEX_PASSWORD ?? '';
  return { id, card6Digits, password };
}

/**
 * Assert a run succeeded and handed back a device key.
 * @param result - Scrape result.
 * @returns The returned key.
 */
function assertKeyReturned(result: IScraperScrapingResult): string {
  assertSuccessfulScrape(result);
  const key = result.persistentOtpToken ?? '';
  expect(key.length).toBeGreaterThan(0);
  return key;
}

DESCRIBE_IF('E2E: Amex (real credentials, API-direct)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (cold, then warm with the returned key)', async () => {
    const creds = coldCreds();
    const cold = await scrapeAmex(creds);
    const coldKey = assertKeyReturned(cold);
    const warmCreds = { ...creds, otpLongTermToken: coldKey };
    const warm = await scrapeAmex(warmCreds);
    const warmKey = assertKeyReturned(warm);
    expect(warmKey).toBe(coldKey);
    logScrapedTransactions(warm);
  });

  it('fails with invalid credentials', async () => {
    const result = await scrapeAmex(INVALID_CREDS_ISRACARD_AMEX);
    assertFailedLogin(result);
  });
});
