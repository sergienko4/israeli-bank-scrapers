/**
 * FilterData-based scraping strategy — monthly GET iteration with JSON filterData.
 * Used for banks whose transaction API requires filterData params (MAX pattern).
 * Extracted from AccountScrapeStrategy.ts to respect max-lines.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import { parseFreshResponse } from '../../../Mediator/Dashboard/TxnParser.js';
import { generateMonthChunks } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import { PIPELINE_WELL_KNOWN_QUERY_KEYS as WK_QUERY } from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';
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
import { EMPTY_TXN_ENDPOINT, type IAccountFetchCtx } from '../ScrapeTypes.js';

type IsPathMatch = Brand<boolean, 'IsPathMatch'>;
type IsFilterDataUrl = Brand<boolean, 'IsFilterDataUrl'>;

const LOG = createLogger('scrape-filter');

/** Rate limit between monthly GET requests (ms). */
const GET_RATE_LIMIT_MS = 300;

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
function pathOrRawIncludes(url: string, parsed: URL | false, keyLower: string): IsPathMatch {
  if (parsed !== false) {
    return parsed.pathname.toLowerCase().includes(keyLower) as IsPathMatch;
  }
  return url.toLowerCase().includes(keyLower) as IsPathMatch;
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
  if (!url) return false as IsFilterDataUrl;
  const parsed = parseOrFalse(url);
  const keyLower = WK_QUERY.filterData.toLowerCase();
  if (parsed !== false && parsed.searchParams.has(WK_QUERY.filterData)) {
    return true as IsFilterDataUrl;
  }
  return pathOrRawIncludes(url, parsed, keyLower) as unknown as IsFilterDataUrl;
}

/**
 * Monthly GET iteration with filterData JSON (MAX pattern).
 * Constructs URL per month with date in filterData, fetches sequentially.
 *
 * <p>Phase 7f: SCRAPE consumes the slim `ITxnEndpoint` typed contract;
 * the buffered-response shortcut that depended on
 * `IDiscoveredEndpoint.responseBody` is removed (R-NET-SCRAPE: zero
 * `IDiscoveredEndpoint` surface in SCRAPE). Every month is a fresh
 * GET — the deliberate perf cost of strict separation.
 *
 * @param fc - Fetch context.
 * @param accountId - Account ID.
 * @param baseUrl - Base transaction API URL (without filterData).
 * @returns Account with all monthly transactions.
 */
async function scrapeViaFilterData(
  fc: IAccountFetchCtx,
  accountId: string,
  baseUrl: string,
): Promise<Procedure<ITransactionsAccount>> {
  const allTxns: ITransaction[] = [];
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
          const fieldMap = (fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT).fieldMap;
          const txns = parseFreshResponse(raw.value, fieldMap);
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
  return buildAccountResult({ fc, accountId, displayId: accountId }, unique);
}

export default scrapeViaFilterData;
export { scrapeViaFilterData };
