import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface';

// 240s to accommodate multi-engine fallback chain (playwright-stealth → rebrowser → patchright)
export const SCRAPE_TIMEOUT = 240000;
export const BROWSER_ARGS = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

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
 * Asserts that a scrape result is successful and contains valid account data.
 *
 * @param result - the scraping result to validate
 * @returns a resolved IDoneResult after all assertions pass
 */
export function assertSuccessfulScrape(result: IScraperScrapingResult): IDoneResult {
  const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
  expect(error).toBe('');
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  // accounts may legitimately be empty when no activity in the billing period
  for (const account of result.accounts ?? []) {
    expect(account.accountNumber).toBeTruthy();
    const isTxnsArray = Array.isArray(account.txns);
    expect(isTxnsArray).toBe(true);
  }
  return { done: true };
}

/**
 * Asserts that a scrape result reflects a known login failure type.
 *
 * @param result - the scraping result to validate
 * @returns a resolved IDoneResult after all assertions pass
 */
export function assertFailedLogin(result: IScraperScrapingResult): IDoneResult {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
  return { done: true };
}

/**
 * Returns a Date one month before the current date for use as a scrape start date.
 *
 * @returns the start date set to one month ago
 */
export function lastMonthStartDate(): Date {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
}

const MAX_TXN_LOG = 10;

/**
 * Masks all but the last four characters of a bank account number.
 *
 * @param acct - the account number string to mask
 * @returns the masked account string
 */
function maskAccount(acct: string): string {
  return acct.length <= 4 ? '****' : '****' + acct.slice(-4);
}

/**
 * Returns a masked representation of a transaction amount for safe logging.
 *
 * @param amount - the amount value, may be absent
 * @returns a masked string indicating sign without revealing the exact amount
 */
function maskAmount(amount?: number): string {
  if (amount == null) return '  ***';
  return amount >= 0 ? ' +***' : ' -***';
}

/**
 * Returns the first three characters of a description followed by asterisks.
 *
 * @param desc - the transaction description to mask
 * @returns the masked description string
 */
function maskDesc(desc: string): string {
  if (!desc) return '***';
  return desc.slice(0, 3) + '***';
}

/**
 * Logs a masked preview of scraped transactions to the console for verification.
 *
 * @param result - the scraping result whose transactions to display
 * @returns a resolved IDoneResult after logging completes
 */
export function logScrapedTransactions(result: IScraperScrapingResult): IDoneResult {
  if (!result.accounts) return { done: true };
  for (const account of result.accounts) {
    const preview = account.txns.slice(0, MAX_TXN_LOG);
    const rows = preview.map(
      /**
       * Formats a single transaction row with masked values.
       *
       * @param t - the transaction to format
       * @returns the formatted row string
       */
      t => {
        const date = t.date ? new Date(t.date).toLocaleDateString('he-IL') : '';
        return `  ${date.padEnd(12)}${maskAmount(t.originalAmount).padStart(6)} ${(t.originalCurrency || '').padEnd(4)} ${maskDesc(t.description || '')}`;
      },
    );
    const remaining = account.txns.length - MAX_TXN_LOG;
    const more = account.txns.length > MAX_TXN_LOG ? `  ... +${String(remaining)} more` : '';
    const acct = maskAccount(account.accountNumber);
    console.log(
      `\n--- IAccount ${acct} | ${String(account.txns.length)} txns ---\n${rows.join('\n')}${more ? `\n${more}` : ''}`,
    );
  }
  return { done: true };
}
