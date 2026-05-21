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

const hasCoreCreds = !!(process.env.PEPPER_PHONE_NUMBER && process.env.PEPPER_PASSWORD);

/**
 * Pepper is opt-in and routes its Transmit-Security auth calls
 * through Camoufox identity transport (Firefox JA3/JA4) via
 * `requiresBrowserTls: true` in PipelineBankConfig — Pepper's
 * edge anti-bot silently withholds the SMS challenge on
 * Node-fetch TLS fingerprints even when the bind/assertPassword
 * envelopes return `error_code: "0"`. Verification path: cold
 * E2E with phone in hand; SMS must arrive within 30s of the
 * assertPassword fetch FIRE log line. Set `PEPPER_E2E_OPT_IN=1`
 * to run; see plan dir `pepper-camoufox-transport-2026-05` for
 * the locked context.
 */
const isOptedIn = process.env.PEPPER_E2E_OPT_IN === '1';
const DESCRIBE_IF = hasCoreCreds && isOptedIn ? describe : describe.skip;

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
    const retrieve = createBankOtpPoller('Pepper', LOG);
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
