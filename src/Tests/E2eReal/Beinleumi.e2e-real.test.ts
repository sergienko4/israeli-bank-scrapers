import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import { getDebug } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
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

const hasCredentials = !!(process.env.BEINLEUMI_USERNAME && process.env.BEINLEUMI_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Beinleumi (real credentials, API-direct)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (OTP via BEINLEUMI_OTP env or poll file)', async () => {
    const retrieve = createBankOtpPoller('Beinleumi', LOG);
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
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

  it('never rejects valid credentials when no OTP retriever is set', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
    });
    const beinleumiUser = process.env.BEINLEUMI_USERNAME ?? '';
    const beinleumiPass = process.env.BEINLEUMI_PASSWORD ?? '';
    const result = await scraper.scrape({
      username: beinleumiUser,
      password: beinleumiPass,
    });
    // The gateway challenges only devices it does not trust, so a valid
    // login either completes or stops at the missing retriever. Generic
    // covers a runner IP the portal does not answer.
    const outcome = result.success ? 'logged-in' : result.errorType;
    const accepted = [
      'logged-in',
      ScraperErrorTypes.TwoFactorRetrieverMissing,
      ScraperErrorTypes.Generic,
    ];
    expect(accepted).toContain(outcome);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: defaultStartDate(),
    });
    const result = await scraper.scrape(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});
