import type { IScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { ITransaction, ITransactionsAccount } from '../Transactions.js';
import { ISRAEL_LOCALE } from './Config/BrowserConfig.js';
import {
  DESC_PREVIEW_LENGTH,
  MASK_TAIL_LENGTH,
  MAX_TXN_PREVIEW,
  SEPARATOR_WIDTH,
} from './Config/ResultFormatterConfig.js';

/** Optional numeric amount — undefined when the bank API omits the field. */
type OptionalAmount = number | undefined;

const SEPARATOR = '\u2550'.repeat(SEPARATOR_WIDTH);

/**
 * Mask an account number for PII-safe logging, showing only last 4 digits.
 * @param acct - The full account number string.
 * @returns The masked account number.
 */
export function maskAccount(acct: string): string {
  return acct.length <= MASK_TAIL_LENGTH ? '****' : '****' + acct.slice(-MASK_TAIL_LENGTH);
}

/**
 * Mask a transaction amount for PII-safe logging, showing only sign.
 * @param amount - The transaction amount (may be undefined).
 * @returns A masked amount indicator string.
 */
export function maskAmount(amount: OptionalAmount): string {
  if (amount == null) return '  ***';
  return amount >= 0 ? ' +***' : ' -***';
}

/**
 * Mask a transaction description, showing only first 3 characters.
 * @param desc - The full transaction description.
 * @returns The masked description.
 */
export function maskDesc(desc: string): string {
  if (!desc) return '***';
  return desc.slice(0, DESC_PREVIEW_LENGTH) + '***';
}

/**
 * Format an ISO date string to Hebrew locale display format.
 * @param isoDate - The ISO date string to format.
 * @returns The formatted date string.
 */
function formatDate(isoDate: string): string {
  return isoDate ? new Date(isoDate).toLocaleDateString(ISRAEL_LOCALE) : '';
}

/**
 * Safely pad a string value that may be null at runtime (bank API quirk).
 * @param value - The string value to pad.
 * @param width - The minimum width to pad to.
 * @returns The padded string.
 */
function safePad(value: string, width: number): string {
  return (value as string | null)?.padEnd(width) ?? ''.padEnd(width);
}

/**
 * Format a single transaction for the result summary log.
 * @param txn - The transaction to format.
 * @returns A formatted single-line transaction summary.
 */
function formatTransaction(txn: ITransaction): string {
  const date = formatDate(txn.date).padEnd(12);
  const amount = maskAmount(txn.originalAmount).padStart(6);
  const currency = safePad(txn.originalCurrency, 4);
  const desc = maskDesc(txn.description);
  return `    - ${date}| ${amount} ${currency}| ${desc}`;
}

/**
 * Format an account's transactions for the result summary log.
 * @param account - The account with transactions to format.
 * @returns An array of formatted log lines.
 */
function formatAccount(account: ITransactionsAccount): string[] {
  const acct = maskAccount(account.accountNumber);
  const balance = maskAmount(account.balance);
  const txnCount = String(account.txns.length);
  const lines: string[] = [];
  lines.push(`  Account: ${acct} | Balance:${balance} | Transactions: ${txnCount}`);
  const preview = account.txns.slice(0, MAX_TXN_PREVIEW);
  for (const txn of preview) {
    const formatted = formatTransaction(txn);
    lines.push(formatted);
  }
  const remaining = account.txns.length - MAX_TXN_PREVIEW;
  const remainingStr = String(remaining);
  if (remaining > 0) lines.push(`    ... +${remainingStr} more`);
  return lines;
}

/**
 * Format a successful scraping result for the summary log.
 * @param result - The successful scraping result.
 * @returns An array of formatted log lines.
 */
function formatSuccess(result: IScraperScrapingResult): string[] {
  const lines: string[] = ['Result: success=true'];
  for (const account of result.accounts ?? []) {
    lines.push(...formatAccount(account));
  }
  return lines;
}

/**
 * Format a failed scraping result for the summary log.
 * @param result - The failed scraping result.
 * @returns An array of formatted log lines.
 */
function formatFailure(result: IScraperScrapingResult): string[] {
  const errorType = result.errorType ?? 'unknown';
  const msg = result.errorMessage ?? 'no error message';
  return [`Result: success=false | errorType=${errorType} | ${msg}`];
}

/**
 * Format a complete scraping result summary for logging.
 * @param bankName - The display name of the bank.
 * @param result - The scraping result to format.
 * @returns An array of formatted log lines with header and body.
 */
export function formatResultSummary(bankName: string, result: IScraperScrapingResult): string[] {
  const header = [SEPARATOR, `  ${bankName}`, SEPARATOR];
  const body = result.success ? formatSuccess(result) : formatFailure(result);
  return [...header, ...body];
}
