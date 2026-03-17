import { maskAccount, maskAmount, maskDesc } from '../../Common/ResultFormatter.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import { CI_BROWSER_ARGS, MAX_TXN_LOG, SCRAPE_TIMEOUT } from '../Config/TestTimingConfig.js';

export { SCRAPE_TIMEOUT };
export const isCiEnvironment = !!process.env.CI;
export const BROWSER_ARGS = isCiEnvironment ? CI_BROWSER_ARGS : [];

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
 * Returns a Date representing the start of last month.
 * @returns Date for the first day of the previous month
 */
export function lastMonthStartDate(): Date {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
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
