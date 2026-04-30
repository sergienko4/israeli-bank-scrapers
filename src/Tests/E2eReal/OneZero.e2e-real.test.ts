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

const hasCoreCreds = !!(
  process.env.ONEZERO_EMAIL &&
  process.env.ONEZERO_PASSWORD &&
  process.env.ONEZERO_PHONE_NUMBER
);
const DESCRIBE_IF = hasCoreCreds ? describe : describe.skip;

DESCRIBE_IF('E2E: OneZero (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (warm path or SMS OTP)', async () => {
    const email = process.env.ONEZERO_EMAIL ?? '';
    const password = process.env.ONEZERO_PASSWORD ?? '';
    const phoneNumber = process.env.ONEZERO_PHONE_NUMBER ?? '';
    const cache = createTokenCache({
      bankKey: 'onezero',
      envFlag: 'ONEZERO_OTP_LONG_TERM',
      log: LOG,
    });
    const cachedToken = await cache.read();
    const retrieve = createOtpPoller({
      envVar: 'ONEZERO_OTP',
      fileName: 'onezero-otp.txt',
      log: LOG,
    });
    // Always include phoneNumber + retriever so mediator's retryOn401
    // → primeFresh can run a fresh SMS flow when cached token is stale.
    const warmCreds = {
      email,
      password,
      phoneNumber,
      otpLongTermToken: cachedToken,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    const coldCreds: ScraperCredentials = {
      email,
      password,
      phoneNumber,
      otpCodeRetriever: retrieve,
    };
    const creds: ScraperCredentials = cachedToken.length > 0 ? warmCreds : coldCreds;
    LOG.info(
      {
        cacheEnabled: cache.enabled,
        cacheHit: cachedToken.length > 0,
        branch: cachedToken.length > 0 ? 'warm-from-cache' : 'cold',
      },
      'OneZero creds shape',
    );
    const scraper = createScraper({
      companyId: CompanyTypes.OneZero,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      onAuthFlowComplete: cache.writer,
    });
    const result = await scraper.scrape(creds);
    if (!result.success) {
      LOG.error(
        { errorType: result.errorType, errorMessage: result.errorMessage },
        'OneZero scrape failed',
      );
    }

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
