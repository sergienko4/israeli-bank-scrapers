/**
 * POST diagnostics — forensic audit table for the scraped accounts.
 * Leaves a per-account txn record in pipeline.log for every scrape.
 */

import { getDebug as createLogger } from '../../Logging/Debug.js';
import { redactAccount, redactAmount, redactMerchant } from '../../Types/PiiRedactor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { bankMomentOfInstant } from './BankCalendar.js';
import { detectMirroredAccounts } from './MirrorDetection.js';
import { logWindowCompleteness } from './WindowCompletenessAudit.js';

/** Account record with txn list for audit lookup. */
interface IAuditAccount {
  readonly accountNumber: string;
  readonly txns: readonly {
    date: string;
    originalAmount?: number;
    chargedAmount?: number;
    originalCurrency?: string;
    description?: string;
  }[];
}

const LOG = createLogger('scrape-phase');

/**
 * Show an account number for the AUDIT log line. Delegates to the central
 * `redactAccount` so the local dev-mode toggle (`PII_REDACTION=off`)
 * controls audit output the same way it controls every other redacted
 * field — single source of truth.
 * @param acctNum - Full account number string.
 * @returns Stable hint (or raw value when redaction is disabled).
 */
function showLastDigits(acctNum: string): string {
  return redactAccount(acctNum);
}

/**
 * PiiRedactor route for the merchant description (length-tag preserved).
 * @param desc - Raw transaction description.
 * @returns Length-tagged stable hint.
 */
function redactDesc(desc: string): string {
  if (!desc) return '<merchant:0>';
  return redactMerchant(desc);
}

/**
 * Resolve the txn date string used by the audit preview. Returns an
 * empty string when the underlying date is falsy so the dispatch map
 * stays a pure literal lookup.
 *
 * @param raw - Raw transaction date as stored on the audit record.
 * @returns Bank-calendar `D.M.YYYY` when present, else empty string.
 */
function resolveTxnDateLabel(raw: string): string {
  if (!raw) return '';
  return bankMomentOfInstant(raw).format('D.M.YYYY');
}

/**
 * Format one transaction line for debug preview. Amount and description
 * are routed through PiiRedactor strategies so the audit line contains
 * only stable hints (sign of amount, length tag of merchant).
 * @param txn - Transaction record.
 * @returns Formatted string: date | amount currency | description.
 */
function formatTxnLine(txn: IAuditAccount['txns'][number]): string {
  const date = resolveTxnDateLabel(txn.date);
  const rawAmt = txn.chargedAmount ?? txn.originalAmount ?? 0;
  const amt = redactAmount(rawAmt);
  const cur = txn.originalCurrency ?? 'ILS';
  const desc = redactDesc(txn.description ?? '');
  return `  ${date.padEnd(12)} ${amt.padStart(10)} ${cur.padEnd(4)} ${desc}`;
}

/**
 * Log transaction preview for one account.
 * @param acct - Account with transactions.
 * @returns True after logging.
 */
function logTxnPreview(acct: IAuditAccount): boolean {
  const lines = acct.txns.map(formatTxnLine);
  const body = lines.join('\n');
  const cardLabel = showLastDigits(acct.accountNumber);
  LOG.debug({
    stage: 'POST',
    message: `${cardLabel} txns:\n${body}`,
  });
  return true;
}

/**
 * Per-account summary. Fires once per scraped account so consumer-visible
 * counts are mirrored in the log surface.
 * @param acct - Scraped account.
 * @returns True after logging.
 */
function logAccountTxnSummary(acct: IAuditAccount): boolean {
  const acctLabel = showLastDigits(acct.accountNumber);
  const count = String(acct.txns.length);
  LOG.info({
    stage: 'POST',
    message: `--- Account ${acctLabel} | ${count} txns ---`,
  });
  if (acct.txns.length > 0) logTxnPreview(acct);
  return true;
}

/**
 * Emit the mirror-check line. Pulled out so {@link logForensicAudit}
 * stays a flat compose helper.
 *
 * @param accounts - Scraped accounts evaluated by the mirror check.
 * @returns Always true (sentinel for callers).
 */
function logMirrorCheck(accounts: readonly IAuditAccount[]): true {
  const mirrorResult = detectMirroredAccounts(accounts);
  LOG.debug({ stage: 'POST', message: `[AUDIT] | MIRROR CHECK | ${mirrorResult.message} |` });
  return true;
}

/**
 * Log the forensic audit: mirror check, window-completeness verdict, and
 * the per-account txn summary (with redacted txn preview).
 * @param input - Pipeline context.
 * @returns True after logging.
 */
function logForensicAudit(input: IPipelineContext): boolean {
  let accounts: readonly IAuditAccount[] = [];
  if (input.scrape.has) accounts = input.scrape.value.accounts;
  logMirrorCheck(accounts);
  if (input.scrape.has) logWindowCompleteness(input.scrape.value);
  accounts.map(logAccountTxnSummary);
  return true;
}

export default logForensicAudit;
