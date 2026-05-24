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
 * PayBox is API-direct (no browser). The 3-step SMS-OTP login
 * (phoneValidate → pinValidation → loginBySms) returns a long-term
 * JWT that lasts ~2 years; subsequent runs short-circuit the SMS
 * round-trip via warmStart when PAYBOX_OTP_LONG_TERM +
 * PAYBOX_DEVICE_ID16HEX are cached.
 *
 * Skipped when PAYBOX_PHONE_NUMBER is absent — there are no PII
 * defaults baked into this file. Tests fail fast if the WAF rejects
 * the cold-flow signature; the D-9 SIGN_KEY toggle in
 * PipelineBankConfigPayBoxCrypto.ts holds the live-server-accepted
 * literal as of the 2026-05-24 smoke run.
 */
const DESCRIBE_IF = hasCoreCreds ? describe : describe.skip;

DESCRIBE_IF('E2E: PayBox (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (warm path or SMS OTP)', async () => {
    const phoneNumber = process.env.PAYBOX_PHONE_NUMBER ?? '';
    const deviceId16Hex = process.env.PAYBOX_DEVICE_ID16HEX ?? '';
    const cache = createTokenCache({
      bankKey: 'paybox',
      envFlag: 'PAYBOX_OTP_LONG_TERM',
      log: LOG,
    });
    const cachedToken = await cache.read();
    const retrieve = createBankOtpPoller('PayBox', LOG);
    const hasWarmFields = cachedToken.length > 0 && deviceId16Hex.length > 0;
    const warmCreds = {
      phoneNumber,
      deviceId16Hex,
      otpLongTermToken: cachedToken,
    } as unknown as ScraperCredentials;
    const coldCreds = {
      phoneNumber,
      deviceId16Hex,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    const creds: ScraperCredentials = hasWarmFields ? warmCreds : coldCreds;
    LOG.info(
      {
        cacheEnabled: cache.enabled,
        cacheHit: cachedToken.length > 0,
        deviceIdProvided: deviceId16Hex.length > 0,
        branch: hasWarmFields ? 'warm-from-cache' : 'cold',
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
    logScrapedTransactions(result);
  });
});
