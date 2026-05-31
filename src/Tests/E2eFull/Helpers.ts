import { maskAccount, maskAmount, maskDesc } from '../../Common/ResultFormatter.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import type { ITransaction, ITransactionsAccount } from '../../Transactions.js';
import { CI_BROWSER_ARGS, SCRAPE_TIMEOUT } from '../Config/TestTimingConfig.js';

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
  startDate.setDate(1);
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
}

/**
 * Renders a single transaction as a fixed-width log row.
 *
 * <p>Output shape is one line: `  <date>  <amount> <currency>  <description>`.
 * Date is locale-formatted (he-IL) when present, blank when missing. Amount
 * + description are PII-masked. Used by {@link formatAccountBlock} — never
 * called directly by tests.
 *
 * @param t - Transaction record from the scraper output.
 * @returns Masked one-line preview string.
 */
function formatTxnRow(t: ITransaction): string {
  const date = t.date ? new Date(t.date).toLocaleDateString('he-IL') : '';
  const amount = maskAmount(t.originalAmount);
  const currency = t.originalCurrency ? t.originalCurrency : '';
  const description = maskDesc(t.description ? t.description : '');
  return `  ${date.padEnd(12)}${amount.padStart(6)} ${currency.padEnd(4)} ${description}`;
}

/**
 * Renders one account's full transaction list as a multi-line block.
 *
 * <p>Header line carries the masked account id + total txn count; body
 * lines are one per transaction (no slicing). All transactions in the
 * billing-period window appear so the visible date range matches the
 * deduplicated result the scraper returned.
 *
 * @param account - One scraper-returned account record.
 * @returns Masked block string ready for console.log.
 */
function formatAccountBlock(account: ITransactionsAccount): string {
  const rows = account.txns.map(formatTxnRow);
  const txnCount = String(account.txns.length);
  const acct = maskAccount(account.accountNumber);
  return `\n--- Account ${acct} | ${txnCount} txns ---\n${rows.join('\n')}`;
}

/**
 * Logs ALL scraped transactions per account for test debugging.
 *
 * <p>Prints every transaction (no slice / "+ N more" truncation) so the
 * full billing-period window's date range is visible on every test run.
 * Tail output is masked via {@link maskAmount} + {@link maskDesc} +
 * {@link maskAccount}.
 *
 * @param result - The scraper result containing accounts.
 * @returns True after all account blocks are emitted.
 */
export function logScrapedTransactions(result: IScraperScrapingResult): boolean {
  if (!result.accounts) return true;
  for (const account of result.accounts) {
    const block = formatAccountBlock(account);
    console.log(block);
  }
  return true;
}
