import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { INVALID_CREDS_HAPOALIM } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.HAPOALIM_USER_CODE && process.env.HAPOALIM_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Bank Hapoalim (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      userCode: process.env.HAPOALIM_USER_CODE ?? '',
      password: process.env.HAPOALIM_PASSWORD ?? '',
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_HAPOALIM);
    assertFailedLogin(result);
  });
});
