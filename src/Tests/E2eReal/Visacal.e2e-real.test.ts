import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);

/**
 * Visa Cal logs in over the bank's API and opens no browser. A cold login
 * (password) returns a long-term hash on `persistentOtpToken`; a warm login
 * sends only that hash. The bank rotates the hash on every login, so each run
 * hands back a new token. Cal sends no SMS, so a rejected hash costs nothing:
 * the pipeline falls back to the password login by itself. The mocked suite
 * pins which login steps ran; this suite proves the real bank accepts both.
 */
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

/** Visa Cal's password credentials. */
interface ICalPasswordCreds {
  readonly username: string;
  readonly password: string;
}

/**
 * Run one Visa Cal scrape with a fresh scraper.
 * @param creds - Cold or warm credentials.
 * @returns The scrape result.
 */
function scrapeCal(creds: ScraperCredentials): Promise<IScraperScrapingResult> {
  const scraper = createScraper({ companyId: CompanyTypes.VisaCal, startDate: defaultStartDate() });
  return scraper.scrape(creds);
}

/**
 * Read the password credentials from the environment.
 * @returns Cold credentials.
 */
function coldCreds(): ICalPasswordCreds {
  const username = process.env.VISACAL_USERNAME ?? '';
  const password = process.env.VISACAL_PASSWORD ?? '';
  return { username, password };
}

/**
 * Assert a run succeeded and handed back a long-term token.
 * @param result - Scrape result.
 * @returns The returned token.
 */
function assertTokenReturned(result: IScraperScrapingResult): string {
  assertSuccessfulScrape(result);
  const token = result.persistentOtpToken ?? '';
  expect(token.length).toBeGreaterThan(0);
  return token;
}

DESCRIBE_IF('E2E: VisaCal (real credentials, API-direct)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('logs in cold, then warm with the returned token', async () => {
    const creds = coldCreds();
    const cold = await scrapeCal(creds);
    const coldToken = assertTokenReturned(cold);
    const warmCreds = { ...creds, otpLongTermToken: coldToken };
    const warm = await scrapeCal(warmCreds);
    const warmToken = assertTokenReturned(warm);
    expect(warmToken).not.toBe(coldToken);
    logScrapedTransactions(warm);
  });

  it('fails with invalid credentials', async () => {
    const result = await scrapeCal(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});
