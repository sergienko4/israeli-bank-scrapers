import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { getDebug } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { INVALID_CREDS_HAPOALIM } from '../TestConstants.js';
import { hapoalimWarmRunKindOf } from './HapoalimWarmHarness.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';
import { createBankOtpPoller } from './OtpPoller.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCredentials = !!(process.env.HAPOALIM_USER_CODE && process.env.HAPOALIM_PASSWORD);
/**
 * A flagged warm run belongs to `HapoalimWarm.e2e-real.test.ts`, so this cold
 * suite skips it and one invocation runs exactly one scenario.
 */
const isWarmRun = hapoalimWarmRunKindOf(process.env) !== 'off';
const DESCRIBE_IF = hasCredentials && !isWarmRun ? describe : describe.skip;

DESCRIBE_IF('E2E: Bank Hapoalim (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const retrieve = createBankOtpPoller('Hapoalim', LOG);
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: defaultStartDate(),
      otpCodeRetriever: retrieve,
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
    });
    const result = await scraper.scrape(INVALID_CREDS_HAPOALIM);
    assertFailedLogin(result);
  });
});
