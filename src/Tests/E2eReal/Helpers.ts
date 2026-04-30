import { maskAccount, maskAmount, maskDesc } from '../../Common/ResultFormatter.js';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import { CI_BROWSER_ARGS, MAX_TXN_LOG, SCRAPE_TIMEOUT } from '../Config/TestTimingConfig.js';

export { SCRAPE_TIMEOUT };
export const isCiEnvironment = !!process.env.CI;
export const BROWSER_ARGS = isCiEnvironment ? CI_BROWSER_ARGS : [];

const FAILED_LOGIN_TYPES: string[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
  // Banks that require OTP can't complete login with invalid creds — valid failure
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

/**
 * Asserts that a scrape result indicates successful login and data retrieval.
 * @param result - the scraper result to validate
 * @returns true when all assertions pass
 */
export function assertSuccessfulScrape(result: IScraperScrapingResult): boolean {
  const errorType = result.errorType ?? '';
  const errorMessage = result.errorMessage ?? '';
  const error = `${errorType} ${errorMessage}`.trim();
  expect(error).toBe('');
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  // accounts may legitimately be empty when no activity in the billing period
  const accounts = result.accounts ?? [];
  for (const account of accounts) {
    expect(account.accountNumber).toBeTruthy();
    const isArray = Array.isArray(account.txns);
    expect(isArray).toBe(true);
  }
  return true;
}

/**
 * Asserts that a scrape result indicates a failed login.
 * @param result - the scraper result to validate
 * @returns true when all assertions pass
 */
export function assertFailedLogin(result: IScraperScrapingResult): boolean {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
  return true;
}

/**
 * Default look-back window for E2E happy-path scrapes.
 * 180 days covers most card billing cycles and gives enough history
 * to validate transactions even when the current cycle is still open.
 */
const DEFAULT_HAPPY_PATH_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the default start date for happy-path E2E scrapes (180 days back).
 * @returns Date 180 days before now
 */
export function defaultStartDate(): Date {
  return new Date(Date.now() - DEFAULT_HAPPY_PATH_DAYS * MS_PER_DAY);
}

/**
 * Logs a preview of scraped transactions for test debugging.
 * @param result - the scraper result containing accounts
 * @returns true when logging completes
 */
export function logScrapedTransactions(result: IScraperScrapingResult): boolean {
  if (!result.accounts) return true;
  for (const account of result.accounts) {
    const preview = account.txns.slice(0, MAX_TXN_LOG);
    const rows = preview.map(t => {
      const date = t.date ? new Date(t.date).toLocaleDateString('he-IL') : '';
      const amount = maskAmount(t.originalAmount);
      const currency = t.originalCurrency ? t.originalCurrency : '';
      const description = maskDesc(t.description ? t.description : '');
      return `  ${date.padEnd(12)}${amount.padStart(6)} ${currency.padEnd(4)} ${description}`;
    });
    const txnCount = account.txns.length;
    const more = txnCount > MAX_TXN_LOG ? `  ... +${String(txnCount - MAX_TXN_LOG)} more` : '';
    const acct = maskAccount(account.accountNumber);
    console.log(
      `\n--- Account ${acct} | ${String(txnCount)} txns ---\n${rows.join('\n')}${more ? `\n${more}` : ''}`,
    );
  }
  return true;
}
