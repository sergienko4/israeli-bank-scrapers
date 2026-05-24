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

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCoreCreds = !!process.env.PAYBOX_PHONE_NUMBER;

/**
 * PayBox is API-direct (no browser). The user supplies only
 * `phoneNumber`; the scraper bootstraps the per-install
 * deviceId16Hex internally on cold run, walks the 3-step SMS-OTP
 * login (phoneValidate → pinValidation → loginBySms), and pulls
 * wallet + debit transactions from the REST endpoints.
 *
 * The SMS OTP code is fetched via the existing Telegram OTP poller
 * (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID), same pattern as Pepper /
 * OneZero. No persisted state is required between runs.
 *
 * Skipped when PAYBOX_PHONE_NUMBER is absent — no PII defaults are
 * baked into this file. Cold path runs every time in CI; warm-path
 * caching is a future optimisation tracked by the token-cache layer.
 */
const DESCRIBE_IF = hasCoreCreds ? describe : describe.skip;

DESCRIBE_IF('E2E: PayBox (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully via SMS OTP', async () => {
    const phoneNumber = process.env.PAYBOX_PHONE_NUMBER ?? '';
    const retrieve = createBankOtpPoller('PayBox', LOG);
    const creds = {
      phoneNumber,
      otpCodeRetriever: retrieve,
    } as unknown as ScraperCredentials;
    LOG.info({ branch: 'cold' }, 'PayBox creds shape');
    const scraper = createScraper({
      companyId: CompanyTypes.PayBox,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
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
