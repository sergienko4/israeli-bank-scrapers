import type { IScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import {
  redactAccount,
  redactAmount,
  redactErrorMessage,
  redactMerchant,
  redactSensitiveEnum,
} from '../Scrapers/Pipeline/Types/PiiRedactor.js';
import type { ITransaction, ITransactionsAccount } from '../Transactions.js';
import { ISRAEL_LOCALE } from './Config/BrowserConfig.js';
import { MAX_TXN_PREVIEW, SEPARATOR_WIDTH } from './Config/ResultFormatterConfig.js';

/** Optional numeric amount — undefined when the bank API omits the field. */
type OptionalAmount = number | undefined;

const SEPARATOR = '\u2550'.repeat(SEPARATOR_WIDTH);

/**
 * Mask an account number for PII-safe logging via the single source of
 * truth (PiiRedactor.redactAccount). Pads the hint with one extra '*'
 * so the test-summary output keeps its 4-asterisk visual prefix.
 * @param acct - The full account number string.
 * @returns The masked account number.
 */
export function maskAccount(acct: string): string {
  if (acct.length === 0) return '****';
  const hint = redactAccount(acct);
  if (hint.length === 0) return '****';
  if (hint === '[REDACTED]') return '****';
  if (hint.startsWith('***')) return `*${hint}`;
  return hint;
}

/**
 * Mask a transaction amount for PII-safe logging via PiiRedactor.redactAmount.
 * Adds a leading space so log columns stay aligned.
 * @param amount - The transaction amount (may be undefined).
 * @returns A masked amount indicator string.
 */
export function maskAmount(amount: OptionalAmount): string {
  if (amount === undefined) return '  ***';
  const sign = redactAmount(amount);
  return ` ${sign}`;
}

/**
 * Mask a transaction description via PiiRedactor.redactMerchant — returns
 * a length-tagged hint like '<merchant:14>' that preserves grapheme count
 * without revealing the merchant identity.
 * @param desc - The full transaction description.
 * @returns The masked description.
 */
export function maskDesc(desc: string): string {
  if (!desc) return '<merchant:0>';
  return redactMerchant(desc);
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
 *
 * <p>Closes CodeQL alert #28 (`js/clear-text-logging`) for the
 * `errorType` discriminated-union tag. Spec.txt §1 RC-1 + the
 * project's `logging-pii-guidlines.md` §1 require preventive
 * masking BEFORE the line is composed: bank-side `errorMessage`
 * can echo credentials (already redacted via
 * {@link redactErrorMessage}) AND sensitive enum tags like
 * `InvalidPassword` / `ChangePassword` can be pivoted on
 * by an attacker scraping logs. The central PiiRedactor Pino censor
 * only operates on structured payloads — values interpolated into the
 * `msg` argument bypass redaction, so both fields are masked
 * here at the source.
 *
 * @param result - The failed scraping result.
 * @returns An array of formatted log lines with both
 *   `errorType` and `errorMessage` redacted at composition
 *   time.
 */
function formatFailure(result: IScraperScrapingResult): string[] {
  const rawErrorType = result.errorType ?? 'unknown';
  const safeErrorType = redactSensitiveEnum(rawErrorType);
  const rawMsg = result.errorMessage ?? '';
  const safeMsg = rawMsg.length === 0 ? 'no error message' : redactErrorMessage(rawMsg);
  return [`Result: success=false | errorType=${safeErrorType} | msg=${safeMsg}`];
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
