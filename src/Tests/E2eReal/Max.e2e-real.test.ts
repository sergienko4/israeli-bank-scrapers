import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
import {
  assertSuccessfulScrape,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.MAX_USERNAME && process.env.MAX_PASSWORD);

/**
 * Max logs in over its web app's own API. Every run
 * logs in cold with the username and password; the bank keeps the session
 * in a cookie and hands back no long-term token. The mocked suite pins the
 * calls and refusals; this suite proves the real bank accepts the login.
 */
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

/**
 * Run one Max scrape with a fresh scraper.
 * @param creds - Username and password.
 * @returns The scrape result.
 */
function scrapeMax(creds: ScraperCredentials): Promise<IScraperScrapingResult> {
  const scraper = createScraper({ companyId: CompanyTypes.Max, startDate: defaultStartDate() });
  return scraper.scrape(creds);
}

DESCRIBE_IF('E2E: Max (real credentials, API-direct)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (cold, over the API)', async () => {
    const username = process.env.MAX_USERNAME ?? '';
    const password = process.env.MAX_PASSWORD ?? '';
    const result = await scrapeMax({ username, password });
    assertSuccessfulScrape(result);
    const accounts = result.accounts ?? [];
    const hasNumericBalances = accounts.every((account): boolean =>
      Number.isFinite(account.balance),
    );
    expect(hasNumericBalances).toBe(true);
    expect(result.persistentOtpToken).toBeUndefined();
    logScrapedTransactions(result);
  });

  it('rejects synthetic invalid credentials with HTTP 400', async () => {
    const result = await scrapeMax(INVALID_CREDS_USERNAME_PASSWORD);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    const isHttp400 = result.errorMessage?.startsWith('login HTTP 400') ?? false;
    expect(isHttp400).toBe(true);
  });
});
