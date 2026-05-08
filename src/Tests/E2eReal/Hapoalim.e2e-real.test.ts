import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { getDebug } from '../../Scrapers/Pipeline/Types/Debug.js';
import { INVALID_CREDS_HAPOALIM } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';
import { createOtpPoller } from './OtpPoller.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCredentials = !!(process.env.HAPOALIM_USER_CODE && process.env.HAPOALIM_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Bank Hapoalim (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const retrieve = createOtpPoller({
      envVar: 'HAPOALIM_OTP',
      fileName: 'hapoalim-otp.txt',
      log: LOG,
      bankRegex: /(?:Hapoalim|הפועלים)\D*(\d{4,8})/,
    });
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
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
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_HAPOALIM);
    assertFailedLogin(result);
  });
});
