/**
 * FilterData-based scraping strategy — monthly GET iteration with JSON filterData.
 * Used for banks whose transaction API requires filterData params (MAX pattern).
 * Extracted from AccountScrapeStrategy.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import {
  extractTransactions,
  findFieldValue,
  generateMonthChunks,
} from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import {
  PIPELINE_WELL_KNOWN_QUERY_KEYS as WK_QUERY,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import {
  buildAccountResult,
  buildFilterDataUrl,
  deduplicateTxns,
  parseStartDate,
  rateLimitPause,
} from '../ScrapeDataActions.js';
import type { IAccountFetchCtx } from '../ScrapeTypes.js';

const LOG = createLogger('scrape-filter');

/** Rate limit between monthly GET requests (ms). */
const GET_RATE_LIMIT_MS = 300;
/** Display card ID extracted from response. */
type CardDisplayId = string;
/** Account identifier passed to the strategy. */
type AccountId = string;
/** Base transaction API URL. */
type EndpointUrl = string;
/** Whether the captured URL carries the filterData monthly-pagination param. */
type IsFilterDataUrl = boolean;

/**
 * Safe-parse URL; returns false on malformed input.
 * @param url - Candidate URL string.
 * @returns Parsed URL or false.
 */
function parseOrFalse(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Test a URL's path OR full string for a case-insensitive key substring.
 * Scoped helper to avoid nested blocks in isFilterDataUrl.
 * @param url - Original URL string.
 * @param parsed - Already-parsed URL (or false).
 * @param keyLower - Lowercased probe.
 * @returns True on match.
 */
function pathOrRawIncludes(url: string, parsed: URL | false, keyLower: string): IsFilterDataUrl {
  if (parsed !== false) return parsed.pathname.toLowerCase().includes(keyLower);
  return url.toLowerCase().includes(keyLower);
}

/**
 * Probe a URL for the filterData family — query param OR path segment.
 * MAX uses a query param (?filterData=…), VisaCal uses a path segment
 * (/filteredTransactions/…). Both route through this strategy's
 * buffered-response path which harvests whatever txns were captured.
 * @param url - Captured endpoint URL.
 * @returns True when the URL exposes the filterData family shape.
 */
export function isFilterDataUrl(url: string): IsFilterDataUrl {
  if (!url) return false;
  const parsed = parseOrFalse(url);
  const keyLower = WK_QUERY.filterData.toLowerCase();
  if (parsed !== false && parsed.searchParams.has(WK_QUERY.filterData)) return true;
  return pathOrRawIncludes(url, parsed, keyLower);
}

/** Buffered txn extraction result. */
interface IBufferedTxns {
  readonly txns: readonly ITransaction[];
  readonly displayId: CardDisplayId;
  readonly body: Record<string, unknown> | undefined;
}

/**
 * Extract displayId from raw response by scanning for shortCardNumber in arrays.
 * @param body - Raw parsed response body.
 * @returns Card number or empty string.
 */
function extractDisplayIdFromRaw(body: Record<string, unknown>): CardDisplayId {
  const result = body.result as Record<string, unknown> | undefined;
  if (!result) return '';
  const txnArray = result.transactions as Record<string, unknown>[] | undefined;
  if (!Array.isArray(txnArray) || txnArray.length === 0) return '';
  const first = txnArray[0];
  const cardId = findFieldValue(first, WK.displayId);
  if (cardId === false) return '';
  return String(cardId);
}

/**
 * Extract transactions from captured response body (zero network cost).
 * Uses the captured getTransactionsAndGraphs response from DASHBOARD.
 * @param network - Network discovery with captured endpoints.
 * @returns Extracted transactions + displayId from buffered response.
 */
function extractBufferedTxns(network: IAccountFetchCtx['network']): IBufferedTxns {
  const endpoint = network.discoverTransactionsEndpoint();
  if (endpoint === false) return { txns: [], displayId: '', body: undefined };
  if (!endpoint.responseBody) return { txns: [], displayId: '', body: undefined };
  const body = endpoint.responseBody as Record<string, unknown>;
  const txns = extractTransactions(body);
  if (txns.length === 0) return { txns: [], displayId: '', body };
  const displayId = extractDisplayIdFromRaw(body);
  return { txns, displayId, body };
}

/**
 * Monthly GET iteration with filterData JSON (MAX pattern).
 * Constructs URL per month with date in filterData, fetches sequentially.
 * Uses buffered response for current month (zero cost), fresh GETs for others.
 * @param fc - Fetch context.
 * @param accountId - Account ID.
 * @param baseUrl - Base transaction API URL (without filterData).
 * @returns Account with all monthly transactions.
 */
async function scrapeViaFilterData(
  fc: IAccountFetchCtx,
  accountId: AccountId,
  baseUrl: EndpointUrl,
): Promise<Procedure<ITransactionsAccount>> {
  const buffered = extractBufferedTxns(fc.network);
  const allTxns: ITransaction[] = [...buffered.txns];
  const displayId = buffered.displayId || accountId;
  LOG.debug({ message: `buffered: ${String(buffered.txns.length)} txns, displayId=${displayId}` });
  const startDate = parseStartDate(fc.startDate);
  const chunks = generateMonthChunks(startDate, new Date(), fc.futureMonths);
  const seed = Promise.resolve(true as const);
  const chain = chunks.reduce(
    (prev, chunk): Promise<true> =>
      prev.then(async (): Promise<true> => {
        const chunkDate = new Date(chunk.start);
        const yyyy = chunkDate.getFullYear();
        const month = chunkDate.getMonth() + 1;
        const url = buildFilterDataUrl(baseUrl, yyyy, month);
        LOG.debug({ message: `GET filterData: ${chunk.start}` });
        const raw = await fc.api.fetchGet<Record<string, unknown>>(url);
        if (isOk(raw)) {
          const txns = extractTransactions(raw.value);
          allTxns.push(...txns);
        }
        return rateLimitPause(GET_RATE_LIMIT_MS);
      }),
    seed,
  );
  await chain;
  const startMs = startDate.getTime();
  const unique = deduplicateTxns(allTxns, startMs);
  LOG.debug({ message: `${String(unique.length)} txns after dedup` });
  return buildAccountResult({ fc, accountId, displayId, rawRecord: buffered.body }, unique);
}

export default scrapeViaFilterData;
export { scrapeViaFilterData };
