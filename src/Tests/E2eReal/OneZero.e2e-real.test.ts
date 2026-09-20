import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes } from '../../index.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { getDebug } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { assertSuccessfulScrape, logScrapedTransactions, SCRAPE_TIMEOUT } from './Helpers.js';
import { createLoginWitness } from './LoginWitness.js';
import type { OtpRetriever } from './OtpBudget.js';
import { createOtpBudget } from './OtpBudget.js';
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
    const otpBudget = createOtpBudget();
    const loginWitness = createLoginWitness(cache.writer);
    const warmPoller = createBankOtpPoller('OneZero', LOG);
    const retrieve = otpBudget.meter(warmPoller);
    /**
     * Build a metered OTP retriever for a cold attempt.
     * @returns Retriever charged to this run's budget.
     */
    const meterColdPoller = (): OtpRetriever => {
      const coldPoller = createBankOtpPoller('OneZero', LOG);
      return otpBudget.meter(coldPoller);
    };
    // Both retrievers are metered through one budget, so the run — not any
    // single scraper — is what is held to a single SMS. The warm creds keep a
    // retriever because the bank sends the message a step BEFORE the retriever
    // is consulted: withholding it would waste that message, not save it.
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
      otpCodeRetriever: meterColdPoller(),
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
      onAuthFlowComplete: loginWitness.writer,
    });
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken,
      warmCreds,
      coldCreds: buildColdCreds,
      otpBudget,
      loginWitness,
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
