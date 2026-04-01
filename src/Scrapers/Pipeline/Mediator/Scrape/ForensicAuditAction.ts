/**
 * POST diagnostics — forensic audit table for qualified/pruned cards.
 * Phase 23: Lifecycle separation.
 */

import { getDebug as createLogger } from '../../Types/Debug.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** Whether an audit entry was logged. */
type IsAuditEntry = boolean;
/** Account number identifier. */
type AccountNum = string;
/** Date string from transaction. */
type TxnDateStr = string;
/** Account record with txn list for audit lookup. */
interface IAuditAccount {
  readonly accountNumber: AccountNum;
  readonly txns: readonly { date: TxnDateStr }[];
}

const LOG = createLogger('scrape-phase');

/**
 * Log one qualified card's audit entry.
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
  LOG.debug('[AUDIT] | %s | QUALIFIED | API Success | %s |', card, txnCount);
  return true;
}

/**
 * Log the forensic audit table — qualified vs pruned cards.
 * @param input - Pipeline context with scrapeDiscovery.
 * @returns True if audit was logged.
 */
function logForensicAudit(input: IPipelineContext): IsAuditEntry {
  if (!input.scrapeDiscovery.has) return false;
  const disc = input.scrapeDiscovery.value;
  let accounts: readonly IAuditAccount[] = [];
  if (input.scrape.has) {
    accounts = input.scrape.value.accounts;
  }
  LOG.debug('[AUDIT] | Card | Status | Reason | Txns |');
  disc.qualifiedCards.map((card: string): IsAuditEntry => logQualifiedCard(card, accounts));
  disc.prunedCards.map((card: string): IsAuditEntry => {
    LOG.debug('[AUDIT] | %s | PRUNED | API Error | 0 |', card);
    return true;
  });
  return true;
}

/**
 * SCRAPE POST step — diagnostics + forensic audit table.
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
  const hasDiscovery: IsAuditEntry = input.scrapeDiscovery.has;
  if (hasDiscovery) logForensicAudit(input);
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
