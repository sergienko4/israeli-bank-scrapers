/**
 * Pending transaction strategy — fetches unbilled/in-process transactions.
 * Fires POST to getClearanceRequests using captured auth headers.
 * Merges pending txns into existing account results.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import { findFieldValue } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { IApiFetchContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';

type SafeFieldStr = Brand<string, 'SafeFieldStr'>;
type DisplayFromRecord = Brand<string, 'DisplayFromRecord'>;

const LOG = createLogger('pending-strategy');

/** Raw pending transaction from API. */
interface IPendingTxn {
  readonly trnAmt: number;
  readonly merchantName: string;
  readonly trnPurchaseDate: string;
  readonly trnCurrencySymbol: string;
}

/** Pending API card result. */
interface IPendingCard {
  readonly cardUniqueID: string;
  readonly authDetalisList: readonly IPendingTxn[];
}

/** Pending API response shape. */
interface IPendingResponse {
  readonly result?: { readonly cardsList: readonly IPendingCard[] };
  readonly statusCode: number;
}

/**
 * Map one pending txn to ITransaction.
 * @param raw - Raw pending record.
 * @returns Mapped transaction.
 */
function mapPendingTxn(raw: IPendingTxn): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date: raw.trnPurchaseDate,
    processedDate: raw.trnPurchaseDate,
    originalAmount: raw.trnAmt,
    originalCurrency: raw.trnCurrencySymbol || 'ILS',
    chargedAmount: raw.trnAmt,
    description: raw.merchantName,
    status: TransactionStatuses.Pending,
    identifier: '',
  };
}

// Phase 7e R-API: discoverPendingUrl + extractCardUniqueIds removed.
// The pending URL is pre-resolved by DASHBOARD.FINAL via WK_API.pending
// patterns and committed to ctx.txnEndpoint.pendingUrl. SCRAPE consumes
// the resolved URL and reads the cardUniqueId list from the
// ACCOUNT-RESOLVE.POST records — no WK_API import remains here.

/**
 * Build a map from cardUniqueId to account display number (last4Digits).
 * @param records - Raw account records from discovery.
 * @returns Map of cardUniqueId → last4 display.
 */
/** API record field value — scalar types from JSON responses. */
type FieldValue = string | number | boolean | null | undefined;

/**
 * Safe string extraction from record field.
 * @param val - API field value.
 * @returns String value or empty.
 */
function safeStr(val: FieldValue): SafeFieldStr {
  if (typeof val === 'string') return val as SafeFieldStr;
  if (typeof val === 'number') return val.toString() as SafeFieldStr;
  return '' as SafeFieldStr;
}

/**
 * Extract display ID from an account record using WK displayId fields.
 * @param record - Raw account record.
 * @returns Display string or empty.
 */
function extractDisplayFromRecord(record: Record<string, unknown>): DisplayFromRecord {
  const val = findFieldValue(record, WK_ACCT.displayId);
  if (val !== false) return String(val) as DisplayFromRecord;
  return '' as DisplayFromRecord;
}

/**
 * Build a map from cardUniqueId to account display number (last4Digits).
 * @param records - Raw account records from discovery.
 * @returns Map of cardUniqueId → last4 display.
 */
function buildIdToDisplayMap(records: readonly Record<string, unknown>[]): Map<string, string> {
  const pairs = records.map(r => ({
    uid: safeStr((r.cardUniqueId ?? r.cardUniqueID ?? r.CardUniqueId) as FieldValue),
    display: extractDisplayFromRecord(r),
  }));
  const valid = pairs.filter(p => p.uid.length > 0 && p.display.length > 0);
  const pairCount = String(valid.length);
  const recCount = String(records.length);
  LOG.debug({ message: `idMap: ${pairCount} pairs from ${recCount} records` });
  return new Map(valid.map(p => [p.uid, p.display]));
}

/**
 * Merge pending txns into matching accounts using cardUniqueId→display map.
 * @param accounts - Existing accounts.
 * @param cardsList - Pending API cardsList.
 * @param idMap - string → display number map.
 * @returns Accounts with pending txns appended.
 */
function mergeIntoAccounts(
  accounts: readonly ITransactionsAccount[],
  cardsList: readonly IPendingCard[],
  idMap: Map<string, string>,
): readonly ITransactionsAccount[] {
  const mapped = cardsList.map(card => ({
    display: idMap.get(card.cardUniqueID) ?? card.cardUniqueID,
    txns: card.authDetalisList.map(mapPendingTxn),
  }));
  const nonEmpty = mapped.filter(e => e.txns.length > 0);
  const displayPending = new Map(nonEmpty.map(e => [e.display, e.txns] as const));
  if (displayPending.size === 0) return accounts;
  const total = [...displayPending.values()].flat().length;
  LOG.debug({ message: `pending: ${String(total)} txns` });
  return accounts.map((acct): ITransactionsAccount => {
    const pending = displayPending.get(acct.accountNumber);
    if (!pending) return acct;
    return { ...acct, txns: [...acct.txns, ...pending] };
  });
}

/**
 * Extract cardUniqueId from account records (discovered during PRE).
 * @param accountRecords - Raw account records from discovery.
 * @returns Array of card unique IDs.
 */
function extractIdsFromRecords(
  accountRecords: readonly Record<string, unknown>[],
): readonly string[] {
  const ids = accountRecords
    .map(r => r.cardUniqueId ?? r.cardUniqueID ?? r.CardUniqueId)
    .filter(Boolean)
    .map(String);
  LOG.debug({ message: `pending: ${String(ids.length)} cardIds from records` });
  return [...new Set(ids)];
}

/** Bundled args for pending fetch. */
interface IPendingArgs {
  readonly api: IApiFetchContext;
  readonly accounts: readonly ITransactionsAccount[];
  readonly accountRecords: readonly Record<string, unknown>[];
  /**
   * Pending URL pre-resolved by DASHBOARD.FINAL (Phase 7e). `false` when
   * the bank doesn't expose pending or DASHBOARD skipped the commit.
   */
  readonly pendingUrl: string | false;
}

/**
 * Fetch pending transactions and merge into existing accounts. The
 * pending URL is supplied by the caller (DASHBOARD.FINAL pre-resolves
 * it into `ctx.txnEndpoint.pendingUrl`). The cardUniqueId list comes
 * from the account records ACCOUNT-RESOLVE.POST committed to
 * `ctx.accountDiscovery` — no traffic re-discovery, no WK access.
 * @param args - Bundled pending fetch arguments.
 * @returns Updated accounts with pending txns added.
 */
async function fetchAndMergePending(args: IPendingArgs): Promise<readonly ITransactionsAccount[]> {
  const { api, accounts, accountRecords, pendingUrl } = args;
  if (pendingUrl === false) return accounts;
  const cardIds = extractIdsFromRecords(accountRecords);
  if (cardIds.length === 0) return accounts;
  LOG.debug({ message: `pending POST: ${String(cardIds.length)} cards` });
  const body = { cardUniqueIDArray: cardIds };
  const raw = await api.fetchPost<IPendingResponse>(pendingUrl, body);
  if (!isOk(raw)) return accounts;
  if (!raw.value.result?.cardsList) return accounts;
  const idMap = buildIdToDisplayMap(accountRecords);
  return mergeIntoAccounts(accounts, raw.value.result.cardsList, idMap);
}

export default fetchAndMergePending;
export { fetchAndMergePending };
