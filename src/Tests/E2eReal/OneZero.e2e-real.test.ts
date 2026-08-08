import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes } from '../../index.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { getDebug } from '../../Scrapers/Pipeline/Types/Debug.js';
import { assertSuccessfulScrape, logScrapedTransactions, SCRAPE_TIMEOUT } from './Helpers.js';
import { createBankOtpPoller } from './OtpPoller.js';
import { createScrapeAttempt } from './ScrapeAttempt.js';
import { createTokenCache } from './TokenCache.js';
import { scrapeWithWarmFallback } from './WarmPathFallback.js';

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
    const retrieve = createBankOtpPoller('OneZero', LOG);
    // Always include phoneNumber + retriever so mediator's retryOn401
    // → primeFresh can run a fresh SMS flow when cached token is stale.
    const warmCreds = {
      email,
      password,
      phoneNumber,
      otpLongTermToken: cachedToken,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    /**
     * Build cold (SMS-OTP) credentials with a fresh OTP retriever.
     * @returns Cold credential shape.
     */
    const buildColdCreds = (): ScraperCredentials => ({
      email,
      password,
      phoneNumber,
      otpCodeRetriever: createBankOtpPoller('OneZero', LOG),
    });
    LOG.info(
      {
        cacheEnabled: cache.enabled,
        cacheHit: cachedToken.length > 0,
        branch: cachedToken.length > 0 ? 'warm-from-cache' : 'cold',
      },
      'OneZero creds shape',
    );
    const runScrape = createScrapeAttempt({
      companyId: CompanyTypes.OneZero,
      onAuthFlowComplete: cache.writer,
    });
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken,
      warmCreds,
      coldCreds: buildColdCreds,
      attempt: runScrape,
      log: LOG,
    });
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
