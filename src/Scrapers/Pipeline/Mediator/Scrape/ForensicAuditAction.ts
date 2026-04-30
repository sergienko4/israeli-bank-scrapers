/**
 * POST diagnostics — forensic audit table for qualified/pruned cards.
 * Phase 23: Lifecycle separation.
 */

import { getDebug as createLogger } from '../../Types/Debug.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { detectMirroredAccounts } from './MirrorDetection.js';

/** Whether an audit entry was logged. */
type IsAuditEntry = boolean;
/** Account number identifier. */
type AccountNum = string;
/** Date string from transaction. */
type TxnDateStr = string;
/** Transaction monetary amount. */
type TxnAmount = number;
/** Currency code string. */
type CurrencyCode = string;
/** Transaction description text. */
type TxnDescStr = string;
/** Show last N digits of account number for identification. */
const ACCOUNT_VISIBLE_DIGITS = 5;
/** Max description chars in preview. */
const DESC_PREVIEW_LENGTH = 25;
/** Account record with txn list for audit lookup. */
interface IAuditAccount {
  readonly accountNumber: AccountNum;
  readonly txns: readonly {
    date: TxnDateStr;
    originalAmount?: TxnAmount;
    chargedAmount?: TxnAmount;
    originalCurrency?: CurrencyCode;
    description?: TxnDescStr;
  }[];
}

const LOG = createLogger('scrape-phase');

/**
 * Log one qualified card's audit entry.
 * @param card - Card ID.
 * @param accounts - Scraped accounts for txn count lookup.
 * @returns True after logging.
 */
/**
 * Show last N digits of an account/card number.
 * @param acctNum - Full account number string.
 * @returns Last 5 digits or full string if shorter.
 */
function showLastDigits(acctNum: string): AccountNum {
  if (acctNum.length <= ACCOUNT_VISIBLE_DIGITS) return acctNum;
  const visible = acctNum.slice(-ACCOUNT_VISIBLE_DIGITS);
  return `***${visible}`;
}

/**
 * Truncate description for preview.
 * @param desc - Full description.
 * @returns Truncated string.
 */
function truncateDesc(desc: TxnDescStr): TxnDescStr {
  if (desc.length <= DESC_PREVIEW_LENGTH) return desc;
  return `${desc.slice(0, DESC_PREVIEW_LENGTH)}..`;
}

/**
 * Format one transaction line for debug preview.
 * @param txn - Transaction record.
 * @returns Formatted string: date | amount currency | description.
 */
function formatTxnLine(txn: IAuditAccount['txns'][number]): TxnDescStr {
  const parsed = new Date(txn.date);
  const formatted = parsed.toLocaleDateString('he-IL');
  const dateMap: Record<string, string> = { true: formatted, false: '' };
  const hasDate = Boolean(txn.date);
  const date = dateMap[String(hasDate)];
  const rawAmt = txn.chargedAmount ?? txn.originalAmount ?? 0;
  const amt = String(rawAmt);
  const cur = txn.originalCurrency ?? 'ILS';
  const desc = truncateDesc(txn.description ?? '');
  return `  ${date.padEnd(12)} ${amt.padStart(10)} ${cur.padEnd(4)} ${desc}`;
}

/**
 * Log transaction preview for one card.
 * @param acct - Account with transactions.
 * @returns True after logging.
 */
function logTxnPreview(acct: IAuditAccount): IsAuditEntry {
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
 * Log one qualified card's audit entry.
 *
 * Card→account lookup may fail when the bank's qualifiedCards card ID
 * doesn't map 1:1 to displayed account numbers (e.g. Beinleumi). Per-account
 * txn counts are reported by `logAccountTxnSummary` independently.
 *
 * @param card - Card ID.
 * @param accounts - Scraped accounts for txn count lookup.
 * @returns True after logging.
 */
function logQualifiedCard(card: string, accounts: readonly IAuditAccount[]): IsAuditEntry {
  const acct = accounts.find((a): IsAuditEntry => a.accountNumber === card);
  let txnCount = '0';
  if (acct) {
    txnCount = String(acct.txns.length);
  }
  const cardLabel = showLastDigits(card);
  LOG.debug({
    stage: 'POST',
    message: `[AUDIT] | ${cardLabel} | QUALIFIED | API Success | ${txnCount} txns |`,
  });
  return true;
}

/**
 * Per-account summary independent of qualifiedCards/accountNumber matching.
 * Always fires once per scraped account so consumer-visible counts are mirrored
 * in the log surface even when card IDs don't match account numbers.
 * @param acct - Scraped account.
 * @returns True after logging.
 */
function logAccountTxnSummary(acct: IAuditAccount): IsAuditEntry {
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
 * Emit qualified/pruned card audit lines when scrapeDiscovery is populated.
 * Browser-driven scrape paths populate discovery; api-direct-call paths
 * don't, so this section is skipped silently for them.
 * @param input - Pipeline context.
 * @param accounts - Scraped accounts (for txn count lookup).
 * @returns True when audit fired, false when skipped (no scrapeDiscovery).
 */
function logCardClassification(
  input: IPipelineContext,
  accounts: readonly IAuditAccount[],
): IsAuditEntry {
  if (!input.scrapeDiscovery.has) return false;
  const disc = input.scrapeDiscovery.value;
  disc.qualifiedCards.map((card: string): IsAuditEntry => logQualifiedCard(card, accounts));
  disc.prunedCards.map((card: string): IsAuditEntry => {
    const prunedLabel = showLastDigits(card);
    LOG.debug({
      stage: 'POST',
      message: `[AUDIT] | ${prunedLabel} | PRUNED | API Error | 0 |`,
    });
    return true;
  });
  return true;
}

/**
 * Log the forensic audit table. Always emits the table header, mirror
 * check, and per-account txn summary (with unmasked txn preview) so
 * EVERY scrape path leaves a record in pipeline.log — browser-driven
 * (qualified/pruned cards present) and api-direct-call (cards block
 * skipped, summary still fires).
 * @param input - Pipeline context.
 * @returns True after logging.
 */
function logForensicAudit(input: IPipelineContext): IsAuditEntry {
  let accounts: readonly IAuditAccount[] = [];
  if (input.scrape.has) accounts = input.scrape.value.accounts;
  LOG.debug({
    stage: 'POST',
    message: '[AUDIT] | Card | Status | Reason | Txns |',
  });
  logCardClassification(input, accounts);
  const mirrorResult = detectMirroredAccounts(accounts);
  LOG.debug({
    stage: 'POST',
    message: `[AUDIT] | MIRROR CHECK | ${mirrorResult.message} |`,
  });
  accounts.map(logAccountTxnSummary);
  return true;
}

/**
 * SCRAPE POST step — diagnostics + forensic audit table.
 * Audit fires whenever scrape produced an accounts array (any path).
 * @param _ctx - Pipeline context (unused).
 * @param input - Pipeline context after scraping.
 * @returns Updated context with diagnostics.
 */
function scrapePostDiagnostics(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  if (input.scrape.has) logForensicAudit(input);
  const updatedDiag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: updatedDiag });
  return Promise.resolve(result);
}

/** SCRAPE POST step. */
const SCRAPE_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-post',
  execute: scrapePostDiagnostics,
};

export { logForensicAudit, SCRAPE_POST_STEP, scrapePostDiagnostics };
