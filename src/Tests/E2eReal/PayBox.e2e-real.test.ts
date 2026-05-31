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
import { createBankOtpPoller } from './OtpPoller.js';
import { createTokenCache } from './TokenCache.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCoreCreds = !!process.env.PAYBOX_PHONE_NUMBER;

/**
 * PayBox routes through a direct REST client (apipin.payboxapp.com) —
 * no Camoufox needed (no Cloudflare WAF on the API host). The login
 * flow is SMS-only: PayBox sends one OTP via SMS that the user types
 * once; the OtpPoller helper memoises the value across the 2-call
 * confirm (/pinValidation + /loginBySms).
 *
 * Test is skipped when PAYBOX_PHONE_NUMBER is absent. When set, the
 * test runs the warm path first (creds.otpLongTermToken from the
 * TokenCache) and falls back to the cold SMS path when no cached
 * token is present.
 *
 * `deviceId16Hex` is NOT a creds input — the pipeline derives it
 * deterministically via the `sha256-prefix-16` bootstrap so the
 * caller never has to persist it. The server-bound JWT remains
 * valid across runs because the derived id is stable.
 */
const DESCRIBE_IF = hasCoreCreds ? describe : describe.skip;

DESCRIBE_IF('E2E: PayBox (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully from the wallet (warm path or SMS OTP)', async () => {
    const phoneNumber = process.env.PAYBOX_PHONE_NUMBER ?? '';
    const cache = createTokenCache({
      bankKey: 'paybox',
      envFlag: 'PAYBOX_OTP_LONG_TERM',
      log: LOG,
    });
    const cachedToken = await cache.read();
    const retrieve = createBankOtpPoller('PayBox', LOG);
    const warmCreds = {
      phoneNumber,
      otpLongTermToken: cachedToken,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    const coldCreds = {
      phoneNumber,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    const creds: ScraperCredentials = cachedToken.length > 0 ? warmCreds : coldCreds;
    LOG.info(
      {
        cacheEnabled: cache.enabled,
        cacheHit: cachedToken.length > 0,
        branch: cachedToken.length > 0 ? 'warm-from-cache' : 'cold',
      },
      'PayBox creds shape',
    );
    const scraper = createScraper({
      companyId: CompanyTypes.PayBox,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      onAuthFlowComplete: cache.writer,
    });
    const result = await scraper.scrape(creds);
    if (!result.success) {
      LOG.error(
        { errorType: result.errorType, errorMessage: result.errorMessage },
        'PayBox scrape failed',
      );
    }

    assertSuccessfulScrape(result);
    expect(result.accounts).toHaveLength(1);
    logScrapedTransactions(result);
  });
});
