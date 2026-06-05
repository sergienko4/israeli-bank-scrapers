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

const AUDIT_LABEL_SUCCESS = 'API Success' as const;
const AUDIT_LABEL_ERROR = 'API Error' as const;
type AuditLabel = typeof AUDIT_LABEL_SUCCESS | typeof AUDIT_LABEL_ERROR;

/** Column widths (chars) for the audit-table transaction line. */
const TXN_DATE_COL_WIDTH = 12;
const TXN_AMOUNT_COL_WIDTH = 10;
const TXN_CURRENCY_COL_WIDTH = 4;

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
 * Resolve the txn date string used by the audit preview. Returns an
 * empty string when the underlying date is falsy so the dispatch map
 * stays a pure literal lookup.
 *
 * @param raw - Raw transaction date as stored on the audit record.
 * @returns `dd/MM/yyyy` (he-IL) when present, else empty string.
 */
function resolveTxnDateLabel(raw: string): string {
  if (!raw) return '';
  return new Date(raw).toLocaleDateString('he-IL');
}

/**
 * Format one transaction line for debug preview. Amount and description
 * are routed through PiiRedactor strategies so the audit line contains
 * only stable hints (sign of amount, length tag of merchant).
 * @param txn - Transaction record.
 * @returns Formatted string: date | amount currency | description.
 */
function formatTxnLine(txn: IAuditAccount['txns'][number]): string {
  const date = resolveTxnDateLabel(txn.date).padEnd(TXN_DATE_COL_WIDTH);
  const rawAmt = txn.chargedAmount ?? txn.originalAmount ?? 0;
  const amt = redactAmount(rawAmt).padStart(TXN_AMOUNT_COL_WIDTH);
  const cur = (txn.originalCurrency ?? 'ILS').padEnd(TXN_CURRENCY_COL_WIDTH);
  const desc = redactDesc(txn.description ?? '');
  return `  ${date} ${amt} ${cur} ${desc}`;
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
 * Map a qualified card's SCRAPE outcome to the AUDIT label. Returns
 * `'API Error'` when SCRAPE failed entirely for the card (no account
 * record produced — typically an HTTP 5xx propagated through
 * `fetchSequential` and short-circuited the pipeline). Otherwise
 * returns the existing `'API Success'` literal so happy-path callers
 * + downstream log-parsing greps stay compatible.
 *
 * <p>The pruned-card branch in {@link logCardClassification} already
 * emits the same `API Error` token; sharing the vocabulary keeps the
 * audit surface a closed two-value enum (`API Success` | `API Error`)
 * rather than introducing a third token. M4.F4 evidence: Visacal CI
 * run `15180979` logged 48 HTTP-500 responses all labelled
 * `API Success` pre-fix.
 *
 * @param scrapeSucceeded - True when an account record exists for the
 *   qualified card; false when SCRAPE failed (no record).
 * @returns Stable label literal — same vocabulary as the pruned-card
 *   branch in {@link logCardClassification}.
 */
function resolveAuditLabel(scrapeSucceeded: boolean): AuditLabel {
  if (!scrapeSucceeded) return AUDIT_LABEL_ERROR;
  return AUDIT_LABEL_SUCCESS;
}

/**
 * Resolve the txn-count label for an audit line — `'0'` for unmatched
 * cards, the actual count otherwise. Pulled out so
 * {@link logQualifiedCard} stays a compose helper.
 *
 * @param acct - Matching account, or omitted when no card→account
 *   pairing was possible (VisaCal-class banks pre-fix).
 * @returns Stringified count for the audit line.
 */
function resolveQualifiedTxnCount(acct?: IAuditAccount): string {
  if (!acct) return '0';
  return String(acct.txns.length);
}

/**
 * Build the `[AUDIT] | <card> | QUALIFIED | <label> | <N> txns |`
 * message for a qualified-card audit line. Pulled out so
 * {@link logQualifiedCard} stays a thin compose helper.
 *
 * @param card - Qualified-card identifier from scrapeDiscovery.
 * @param accounts - Scraped accounts for txn-count lookup.
 * @returns Ready-to-emit audit line.
 */
function buildQualifiedAuditMessage(card: string, accounts: readonly IAuditAccount[]): string {
  const acct = accounts.find((a): boolean => isAccountIdMatch(a.accountNumber, card));
  const txnCount = resolveQualifiedTxnCount(acct);
  const cardLabel = showLastDigits(card);
  const hasAcct = Boolean(acct);
  const label = resolveAuditLabel(hasAcct);
  return `[AUDIT] | ${cardLabel} | QUALIFIED | ${label} | ${txnCount} txns |`;
}

/**
 * Emit one `[AUDIT] | <card> | QUALIFIED | <label> | <N> txns |` line
 * per qualified card. Looks up the matching account via
 * {@link isAccountIdMatch} so VisaCal-class banks (long-form
 * `cardUniqueId` qualified, short-form `last4Digits` accountNumber)
 * report the right txn count instead of always 0. The `<label>`
 * field comes from {@link resolveAuditLabel} so a qualified card
 * whose SCRAPE failed (no account record produced) surfaces
 * `API Error` instead of the misleading `API Success` — M4.F4.
 *
 * @param card - Qualified-card identifier from scrapeDiscovery.
 * @param accounts - Scraped accounts for txn-count lookup.
 * @returns True after logging.
 */
function logQualifiedCard(card: string, accounts: readonly IAuditAccount[]): boolean {
  const message = buildQualifiedAuditMessage(card, accounts);
  LOG.debug({ stage: 'POST', message });
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
 * Log a single pruned card audit line. Pulled out so
 * {@link logCardClassification} stays a thin two-line mapper.
 *
 * @param card - Pruned-card identifier from scrapeDiscovery.
 * @returns Always true (sentinel for callers).
 */
function logPrunedCard(card: string): true {
  const prunedLabel = showLastDigits(card);
  LOG.debug({
    stage: 'POST',
    message: `[AUDIT] | ${prunedLabel} | PRUNED | ${AUDIT_LABEL_ERROR} | 0 |`,
  });
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
  disc.prunedCards.map(logPrunedCard);
  return true;
}

/**
 * Emit the audit table header + mirror-check line. Pulled out so
 * {@link logForensicAudit} stays a flat compose helper.
 *
 * @param accounts - Scraped accounts evaluated by the mirror check.
 * @returns Always true (sentinel for callers).
 */
function logForensicHeader(accounts: readonly IAuditAccount[]): true {
  LOG.debug({ stage: 'POST', message: '[AUDIT] | Card | Status | Reason | Txns |' });
  const mirrorResult = detectMirroredAccounts(accounts);
  LOG.debug({ stage: 'POST', message: `[AUDIT] | MIRROR CHECK | ${mirrorResult.message} |` });
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
  logCardClassification(input, accounts);
  logForensicHeader(accounts);
  accounts.map(logAccountTxnSummary);
  return true;
}

/**
 * Stamp the scrape-post diagnostics line onto the pipeline context.
 * Pulled out so {@link scrapePostDiagnostics} stays under the LoC budget.
 * @param input - Pipeline context after scraping.
 * @returns Procedure with updated diagnostics.
 */
function stampScrapePostDiag(input: IPipelineContext): Procedure<IPipelineContext> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const lastAction = `scrape-post (${String(accountCount)} accounts)`;
  return succeed({ ...input, diagnostics: { ...input.diagnostics, lastAction } });
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
  if (input.scrape.has) logForensicAudit(input);
  const stamped = stampScrapePostDiag(input);
  return Promise.resolve(stamped);
}

/** SCRAPE POST step. */
const SCRAPE_POST_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-post',
  execute: scrapePostDiagnostics,
};

export { logForensicAudit, resolveAuditLabel, SCRAPE_POST_STEP, scrapePostDiagnostics };
