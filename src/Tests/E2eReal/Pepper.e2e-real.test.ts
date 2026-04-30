import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { getDebug } from '../../Scrapers/Pipeline/Types/Debug.js';
import {
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';
import { createOtpPoller } from './OtpPoller.js';
import { createTokenCache } from './TokenCache.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCoreCreds = !!(process.env.PEPPER_PHONE_NUMBER && process.env.PEPPER_PASSWORD);
const DESCRIBE_IF = hasCoreCreds ? describe : describe.skip;

DESCRIBE_IF('E2E: Pepper (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (warm path or SMS OTP)', async () => {
    const phoneNumber = process.env.PEPPER_PHONE_NUMBER ?? '';
    const password = process.env.PEPPER_PASSWORD ?? '';
    const cache = createTokenCache({
      bankKey: 'pepper',
      envFlag: 'PEPPER_OTP_LONG_TERM',
      log: LOG,
    });
    const cachedToken = await cache.read();
    const retrieve = createOtpPoller({
      envVar: 'PEPPER_OTP',
      fileName: 'pepper-otp.txt',
      log: LOG,
    });
    const warmCreds = {
      phoneNumber,
      password,
      otpLongTermToken: cachedToken,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    const coldCreds: ScraperCredentials = {
      phoneNumber,
      password,
      otpCodeRetriever: retrieve,
    };
    const creds: ScraperCredentials = cachedToken.length > 0 ? warmCreds : coldCreds;
    LOG.info(
      {
        cacheEnabled: cache.enabled,
        cacheHit: cachedToken.length > 0,
        branch: cachedToken.length > 0 ? 'warm-from-cache' : 'cold',
      },
      'Pepper creds shape',
    );
    const scraper = createScraper({
      companyId: CompanyTypes.Pepper,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      onAuthFlowComplete: cache.writer,
    });
    const result = await scraper.scrape(creds);
    if (!result.success) {
      LOG.error(
        { errorType: result.errorType, errorMessage: result.errorMessage },
        'Pepper scrape failed',
      );
    }

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
