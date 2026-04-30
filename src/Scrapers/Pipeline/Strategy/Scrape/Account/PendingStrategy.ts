/**
 * Pending transaction strategy — fetches unbilled/in-process transactions.
 * Fires POST to getClearanceRequests using captured auth headers.
 * Merges pending txns into existing account results.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import type { INetworkDiscovery } from '../../../Mediator/Network/NetworkDiscovery.js';
import { findFieldValue } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { IApiFetchContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';

const LOG = createLogger('pending-strategy');

/** Card unique ID string. */
type CardUniqueId = string;
/** Endpoint URL string. */
type EndpointUrl = string;
/** Monetary amount from API. */
type AmountValue = number;
/** API status code. */
type StatusCode = number;

/** Raw pending transaction from API. */
interface IPendingTxn {
  readonly trnAmt: AmountValue;
  readonly merchantName: CardUniqueId;
  readonly trnPurchaseDate: CardUniqueId;
  readonly trnCurrencySymbol: CardUniqueId;
}

/** Pending API card result. */
interface IPendingCard {
  readonly cardUniqueID: CardUniqueId;
  readonly authDetalisList: readonly IPendingTxn[];
}

/** Pending API response shape. */
interface IPendingResponse {
  readonly result?: { readonly cardsList: readonly IPendingCard[] };
  readonly statusCode: StatusCode;
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

/**
 * Discover pending API URL from captured traffic or API origin.
 * @param network - Network discovery.
 * @returns Pending endpoint URL or false.
 */
function discoverPendingUrl(network: INetworkDiscovery): EndpointUrl | false {
  const ep = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.pending);
  if (ep) return ep.url;
  const origin = network.discoverApiOrigin();
  LOG.debug({ message: `pending: apiOrigin=${String(origin)}` });
  if (!origin) return false;
  return `${origin}/Transactions/api/approvals/getClearanceRequests`;
}

/**
 * Extract cardUniqueId values from captured POST bodies.
 * @param network - Network discovery.
 * @returns Array of card unique IDs.
 */
/** Regex for cardUniqueId in POST bodies. */
const CARD_ID_REGEX = /"cardUniqueId"\s*:\s*"([^"]+)"/;

/**
 * Extract one cardUniqueId from a POST body string.
 * @param postData - Raw POST body.
 * @returns Card ID or false.
 */
function extractOneCardId(postData: CardUniqueId): CardUniqueId | false {
  const match = CARD_ID_REGEX.exec(postData);
  if (!match) return false;
  return match[1];
}

/**
 * Extract cardUniqueId values from captured POST bodies.
 * @param network - Network discovery.
 * @returns Array of card unique IDs.
 */
function extractCardUniqueIds(network: INetworkDiscovery): readonly CardUniqueId[] {
  const allEps = network.getAllEndpoints();
  const withPost = allEps.filter(ep => Boolean(ep.postData));
  LOG.debug({ message: `pending: ${String(withPost.length)} POST eps to scan` });
  const extracted = withPost.map(ep => extractOneCardId(ep.postData));
  const valid = extracted.filter((id): id is CardUniqueId => id !== false);
  LOG.debug({ message: `pending: ${String(valid.length)} cardIds found` });
  return [...new Set(valid)];
}

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
function safeStr(val: FieldValue): CardUniqueId {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val.toString();
  return '';
}

/**
 * Extract display ID from an account record using WK displayId fields.
 * @param record - Raw account record.
 * @returns Display string or empty.
 */
function extractDisplayFromRecord(record: Record<string, unknown>): CardUniqueId {
  const val = findFieldValue(record, WK.displayId);
  if (val !== false) return String(val);
  return '';
}

/**
 * Build a map from cardUniqueId to account display number (last4Digits).
 * @param records - Raw account records from discovery.
 * @returns Map of cardUniqueId → last4 display.
 */
function buildIdToDisplayMap(
  records: readonly Record<string, unknown>[],
): Map<CardUniqueId, CardUniqueId> {
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
 * @param idMap - CardUniqueId → display number map.
 * @returns Accounts with pending txns appended.
 */
function mergeIntoAccounts(
  accounts: readonly ITransactionsAccount[],
  cardsList: readonly IPendingCard[],
  idMap: Map<CardUniqueId, CardUniqueId>,
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
): readonly CardUniqueId[] {
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
  readonly network: INetworkDiscovery;
  readonly accounts: readonly ITransactionsAccount[];
  readonly accountRecords: readonly Record<string, unknown>[];
}

/**
 * Fetch pending transactions and merge into existing accounts.
 * @param args - Bundled pending fetch arguments.
 * @returns Updated accounts with pending txns added.
 */
async function fetchAndMergePending(args: IPendingArgs): Promise<readonly ITransactionsAccount[]> {
  const { api, network, accounts, accountRecords } = args;
  const pendingUrl = discoverPendingUrl(network);
  if (!pendingUrl) return accounts;
  const fromRecords = extractIdsFromRecords(accountRecords);
  const fromTraffic = extractCardUniqueIds(network);
  const hasRecordIds = fromRecords.length > 0;
  const cardIdMap: Record<string, readonly CardUniqueId[]> = {
    true: fromRecords,
    false: fromTraffic,
  };
  const cardIds = cardIdMap[String(hasRecordIds)];
  if (cardIds.length === 0) return accounts;
  LOG.debug({ message: `pending POST: ${String(cardIds.length)} cards` });
  const body = { cardUniqueIDArray: cardIds };
  const raw = await api.fetchPost<IPendingResponse>(
    pendingUrl,
    body as unknown as Record<string, string | object>,
  );
  if (!isOk(raw)) return accounts;
  if (!raw.value.result?.cardsList) return accounts;
  const idMap = buildIdToDisplayMap(accountRecords);
  return mergeIntoAccounts(accounts, raw.value.result.cardsList, idMap);
}

export default fetchAndMergePending;
export { fetchAndMergePending };
