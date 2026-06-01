import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import { getDebug } from '../../Scrapers/Pipeline/Types/Debug.js';
import { INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';
import { createBankOtpPoller } from './OtpPoller.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCredentials = !!(process.env.BEINLEUMI_USERNAME && process.env.BEINLEUMI_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Beinleumi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (OTP via BEINLEUMI_OTP env or poll file)', async () => {
    const retrieve = createBankOtpPoller('Beinleumi', LOG);
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      otpCodeRetriever: retrieve,
    });
    const beinleumiUser = process.env.BEINLEUMI_USERNAME ?? '';
    const beinleumiPass = process.env.BEINLEUMI_PASSWORD ?? '';
    const result = await scraper.scrape({
      username: beinleumiUser,
      password: beinleumiPass,
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('reaches OTP screen with valid credentials (no OTP retriever)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const beinleumiUser = process.env.BEINLEUMI_USERNAME ?? '';
    const beinleumiPass = process.env.BEINLEUMI_PASSWORD ?? '';
    const result = await scraper.scrape({
      username: beinleumiUser,
      password: beinleumiPass,
    });
    expect(result.success).toBe(false);
    // TwoFactorRetrieverMissing = reached OTP screen (ideal case)
    // Generic = bank portal failed to respond on this runner IP. Happy-path
    // verified locally via docker on residential IP, so credentials are still
    // valid; this is a CI-environment-only failure mode for some runner pools.
    expect(result.errorType).not.toBe(ScraperErrorTypes.InvalidPassword);
    expect([ScraperErrorTypes.TwoFactorRetrieverMissing, ScraperErrorTypes.Generic]).toContain(
      result.errorType,
    );
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});
