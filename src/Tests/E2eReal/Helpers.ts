import { maskAccount, maskAmount, maskDesc } from '../../Common/ResultFormatter.js';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import type { ITransaction, ITransactionsAccount } from '../../Transactions.js';
import { CI_BROWSER_ARGS, SCRAPE_TIMEOUT } from '../Config/TestTimingConfig.js';

/**
 * Playwright internal teardown error: `_Page.addPageError` (in
 * `playwright-core@1.60.0/lib/coreBundle.js:19951`) reads `.url` off
 * an undefined error object when the browser emits an uncaught error
 * with a malformed payload. Reproduced in CI on Discount runs AFTER
 * the scrape completed successfully (94 txns retrieved) — the test
 * still failed because Jest treats the asynchronous uncaughtException
 * as a test failure. The error is upstream library code; we cannot
 * pre-empt the internal handler from user space, but we CAN filter it
 * at the process boundary so the test's actual assertions decide
 * pass/fail.
 *
 * <p>Marker pattern is the exact frame footprint — we match both the
 * `addPageError` site and the message text so unrelated TypeErrors
 * still surface. Idempotent install (no duplicate handlers across
 * test files that all import this module).
 */
const PLAYWRIGHT_ADD_PAGE_ERROR_MARKER = 'addPageError' as const;
const PLAYWRIGHT_ADD_PAGE_ERROR_MESSAGE =
  "Cannot read properties of undefined (reading 'url')" as const;

/** Once-flag so multiple imports don't register the filter twice. */
let isPlaywrightFilterInstalled = false;

/**
 * Decide whether an `uncaughtException` is the Playwright
 * `addPageError` teardown TypeError we deliberately want to ignore.
 * Pure predicate — extracted from the handler so the install site
 * stays inside the project's max-lines-per-function cap.
 * @param err - Uncaught exception object.
 * @returns True when the error is the known Playwright teardown TypeError.
 */
function isPlaywrightAddPageErrorFalsePositive(err: Error): boolean {
  const stack = err.stack ?? '';
  const msg = err.message;
  if (!msg.includes(PLAYWRIGHT_ADD_PAGE_ERROR_MESSAGE)) return false;
  return stack.includes(PLAYWRIGHT_ADD_PAGE_ERROR_MARKER);
}

/**
 * Install the Playwright `addPageError` uncaughtException filter.
 * Idempotent — safe to call from every test file's import surface.
 * @returns True once installed (or already installed).
 */
function installPlaywrightAddPageErrorFilter(): boolean {
  if (isPlaywrightFilterInstalled) return true;
  isPlaywrightFilterInstalled = true;
  process.on('uncaughtException', (err: Error): boolean => {
    if (isPlaywrightAddPageErrorFalsePositive(err)) {
      // Known Playwright-internal teardown TypeError — scrape already
      // completed; let the test's assertions decide pass/fail.
      return true;
    }
    // Any other uncaught error — re-emit so jest still fails the run.
    throw err;
  });
  return true;
}

installPlaywrightAddPageErrorFilter();

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
 * Assert that a result reports no error (typed result.errorType +
 * errorMessage both empty). Extracted from assertSuccessfulScrape to
 * keep the orchestrator within the test-helper statement cap.
 * @param result - the scraper result to validate
 * @returns true when no error reported
 */
function assertNoErrorReported(result: IScraperScrapingResult): true {
  const errorType = result.errorType ?? '';
  const errorMessage = result.errorMessage ?? '';
  const error = `${errorType} ${errorMessage}`.trim();
  expect(error).toBe('');
  return true;
}

/**
 * Synthetic fallback `accountNumber` value the SCRAPE phase emits when
 * no record carries a display id. Mirrored from the production
 * constant `DEFAULT_ACCOUNT_NUMBER` in
 * `src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts:402`
 * (file-private over there; test-only PR cannot export it without
 * touching production). Any account that lands in CI with this id
 * means account-resolution leaked the fallback and the scrape is a
 * regression — `redactAccount` masks it as `***fault` in production
 * traces.
 */
const BEINLEUMI_DEFAULT_FALLBACK_ID = 'default' as const;

/**
 * Assert that one account has a usable accountNumber and a txns array.
 * Rejects the Beinleumi-class fallback id explicitly — see
 * {@link BEINLEUMI_DEFAULT_FALLBACK_ID}.
 * @param account - one transactions-account from the scrape result
 * @returns true when the account passes per-account assertions
 */
function assertAccountValid(account: ITransactionsAccount): true {
  expect(account.accountNumber).toBeTruthy();
  expect(account.accountNumber).not.toBe(BEINLEUMI_DEFAULT_FALLBACK_ID);
  const isArray = Array.isArray(account.txns);
  expect(isArray).toBe(true);
  return true;
}

/**
 * Assert that the bank reported at least one transaction across all
 * accounts in the 180-day window. Extractor regressions (e.g. Discount
 * returning 6 txns from the API but reporting 0 to the pipeline)
 * silently passed before this stricter assertion was added — every CI
 * bank is known to have activity in the default look-back window, so
 * total === 0 means data is being lost downstream of the scrape.
 * @param accounts - non-empty accounts slice from the scraper result
 * @returns true when total txn count is positive
 */
function assertNonZeroTotalTxns(accounts: readonly ITransactionsAccount[]): true {
  const totalTxns = accounts.reduce((acc, a): number => acc + a.txns.length, 0);
  expect(totalTxns).toBeGreaterThan(0);
  return true;
}

/**
 * Asserts that a scrape result indicates successful login AND meaningful
 * data retrieval per the project rule: a bank with zero accounts, an
 * account with no usable identifier, or a result with zero transactions
 * across the whole 180-day window is treated as a regression — not a
 * "no recent activity" pass — because every CI bank has historical txn
 * activity inside the default look-back window.
 * @param result - the scraper result to validate
 * @returns true when all assertions pass
 */
export function assertSuccessfulScrape(result: IScraperScrapingResult): boolean {
  assertNoErrorReported(result);
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  const accounts = result.accounts ?? [];
  expect(accounts.length).toBeGreaterThan(0);
  for (const account of accounts) assertAccountValid(account);
  assertNonZeroTotalTxns(accounts);
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
 * 180-day window appear so the visible date range matches the
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
 * full 180-day window's date range is visible on every CI run. Tail
 * output is masked via {@link maskAmount} + {@link maskDesc} +
 * {@link maskAccount}. Returns `true` so test code can chain.
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
