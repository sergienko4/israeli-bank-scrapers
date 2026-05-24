import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import type { ScraperCredentials, ScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
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

/**
 * Build the cold-path credentials accepted by the PayBox scraper.
 * Uses the `phoneNumber + otpCodeRetriever` variant of the project
 * {@link ScraperCredentials} union, so no `as unknown as` cast is
 * required at the call site.
 * @returns Scraper credentials carrying the phone + retriever.
 */
function buildPayBoxColdCreds(): ScraperCredentials {
  const phoneNumber = process.env.PAYBOX_PHONE_NUMBER ?? '';
  const otpCodeRetriever = createBankOtpPoller('PayBox', LOG);
  return { phoneNumber, otpCodeRetriever };
}

/**
 * Build the configured PayBox scraper instance for this spec.
 * @returns Live scraper ready to consume the cold-path creds.
 */
function buildPayBoxScraper(): ReturnType<typeof createScraper> {
  return createScraper({
    companyId: CompanyTypes.PayBox,
    startDate: defaultStartDate(),
    shouldShowBrowser: false,
    args: BROWSER_ARGS,
  });
}

/**
 * Log a structured diagnostic when the scrape fails — useful when
 * CI inspects per-bank logs to find the failing step.
 * @param result Scrape result that did not succeed.
 * @returns `true` when a failure was logged, `false` when the scrape
 *   succeeded (the project bans bare `void` returns).
 */
function logScrapeFailure(result: ScraperScrapingResult): boolean {
  if (result.success) return false;
  LOG.error(
    { errorType: result.errorType, errorMessage: result.errorMessage },
    'PayBox scrape failed',
  );
  return true;
}

DESCRIBE_IF('E2E: PayBox (real credentials, config-driven)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully via SMS OTP', async () => {
    const creds = buildPayBoxColdCreds();
    LOG.info({ branch: 'cold' }, 'PayBox creds shape');
    const result = await buildPayBoxScraper().scrape(creds);
    logScrapeFailure(result);
    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
