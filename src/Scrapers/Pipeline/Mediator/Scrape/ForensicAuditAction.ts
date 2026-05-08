/**
 * POST diagnostics — forensic audit table for qualified/pruned cards.
 * Phase 23: Lifecycle separation.
 */

import { getDebug as createLogger } from '../../Types/Debug.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import { redactAccount, redactAmount, redactMerchant } from '../../Types/PiiRedactor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { detectMirroredAccounts } from './MirrorDetection.js';

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
 * Log one qualified card's audit entry.
 * @param card - Card ID.
 * @param accounts - Scraped accounts for txn count lookup.
 * @returns True after logging.
 */
/**
 * Show an account/card number for the AUDIT log line. Delegates to
 * the central `redactAccount` so the local dev-mode toggle
 * (`PII_REDACTION=off`) controls audit output the same way it
 * controls every other redacted field — single source of truth.
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
 * Format one transaction line for debug preview. Amount and description
 * are routed through PiiRedactor strategies so the audit line contains
 * only stable hints (sign of amount, length tag of merchant).
 * @param txn - Transaction record.
 * @returns Formatted string: date | amount currency | description.
 */
function formatTxnLine(txn: IAuditAccount['txns'][number]): string {
  const parsed = new Date(txn.date);
  const formatted = parsed.toLocaleDateString('he-IL');
  const dateMap: Record<string, string> = { true: formatted, false: '' };
  const hasDate = Boolean(txn.date);
  const date = dateMap[String(hasDate)];
  const rawAmt = txn.chargedAmount ?? txn.originalAmount ?? 0;
  const amt = redactAmount(rawAmt);
  const cur = txn.originalCurrency ?? 'ILS';
  const desc = redactDesc(txn.description ?? '');
  return `  ${date.padEnd(12)} ${amt.padStart(10)} ${cur.padEnd(4)} ${desc}`;
}

/**
 * Log transaction preview for one card.
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
/**
 * Bidirectional suffix-compatibility check between an account number
 * and a qualified-card identifier. Returns true when one is a suffix
 * of the other (or they're equal). Generalises across short-form
 * `last4Digits` and long-form `cardUniqueId` representations of the
 * same card without bank-specific branches.
 *
 * @param accountNumber - Final account.accountNumber from SCRAPE.
 * @param card - Qualified-card identifier from scrapeDiscovery.
 * @returns True when the two ids represent the same card.
 */
function isAccountIdMatch(accountNumber: string, card: string): boolean {
  if (accountNumber === card) return true;
  if (accountNumber === '' || card === '') return false;
  return accountNumber.endsWith(card) || card.endsWith(accountNumber);
}

/**
 * Emit one `[AUDIT] | <card> | QUALIFIED | API Success | <N> txns |`
 * line per qualified card. Looks up the matching account via
 * {@link isAccountIdMatch} so VisaCal-class banks (long-form
 * `cardUniqueId` qualified, short-form `last4Digits` accountNumber)
 * report the right txn count instead of always 0.
 *
 * @param card - Qualified-card identifier from scrapeDiscovery.
 * @param accounts - Scraped accounts for txn-count lookup.
 * @returns True after logging.
 */
function logQualifiedCard(card: string, accounts: readonly IAuditAccount[]): boolean {
  // Bidirectional suffix match — VisaCal-class banks expose long-form
  // `cardUniqueId` (e.g. `198302041582022213`) on `qualifiedCards`
  // while the resolved `account.accountNumber` is the short last4
  // form (`3020`). Pre-fix the audit always reported 0 txns for those
  // banks because `accountNumber === card` never held; the bidirectional
  // suffix-match generalises across both directions without bank-
  // specific branches.
  const acct = accounts.find((a): boolean => isAccountIdMatch(a.accountNumber, card));
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
): boolean {
  if (!input.scrapeDiscovery.has) return false;
  const disc = input.scrapeDiscovery.value;
  disc.qualifiedCards.map((card: string): boolean => logQualifiedCard(card, accounts));
  disc.prunedCards.map((card: string): boolean => {
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
function logForensicAudit(input: IPipelineContext): boolean {
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
