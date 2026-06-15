/**
 * Scrape transaction-URL helpers — per-month filterData URL build +
 * priority-ordered txn URL resolution. Drained from
 * `ScrapeDataActions.ts` during the Phase 12e file-size split;
 * `buildFilterDataUrl` + `resolveTxnUrl` are re-exported verbatim
 * from the barrel facade.
 */

import type { INetworkDiscovery } from '../../../Mediator/Network/NetworkDiscovery.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IApiFetchContext } from '../../../Types/PipelineContext.js';

/** Per-month transaction URL. */
type TxnUrlStr = Brand<string, 'TxnUrlStr'>;

/** Bundled params for resolving transaction URL. */
interface ITxnUrlCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly accountId: string;
  readonly startDate: string;
}

/** Generic filterData JSON — "show all" defaults for SPA filter APIs. */
const FILTER_DATA_TEMPLATE = {
  userIndex: -1,
  cardIndex: -1,
  monthView: true,
  date: '{date}',
  dates: { startDate: '0', endDate: '0' },
  bankAccount: { bankAccountIndex: -1, cards: null },
};

/**
 * Build the per-month `filterData` JSON payload with the date slotted in.
 * @param yyyy - calendar year.
 * @param m - calendar month (1-based, no zero-pad).
 * @returns Stringified filterData JSON.
 */
function buildFilterDataJson(yyyy: number, m: number): string {
  const dateStr = `${String(yyyy)}-${String(m)}-01`;
  return JSON.stringify(FILTER_DATA_TEMPLATE).replace('{date}', dateStr);
}

/**
 * Fallback query concatenation for non-parseable (relative) base URLs.
 * Picks `&` when the base already carries a query string so the appended
 * params never produce a malformed double-`?` URL.
 * @param baseUrl - Captured (relative) base URL.
 * @param json - filterData JSON payload.
 * @returns Encoded fallback transaction URL.
 */
function filterDataFallbackUrl(baseUrl: string, json: string): TxnUrlStr {
  const encoded = encodeURIComponent(json);
  const delimiter = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${delimiter}filterData=${encoded}&firstCallCardIndex=-1` as TxnUrlStr;
}

/**
 * Merge `filterData` + `firstCallCardIndex` onto a base URL via
 * URL.searchParams (so existing query params merge correctly), falling
 * back to {@link filterDataFallbackUrl} when the base is not an absolute
 * (parseable) URL — `URL.canParse` avoids a throwing `new URL`.
 * @param baseUrl - Captured transaction base URL.
 * @param json - filterData JSON payload.
 * @returns Full transaction URL.
 */
function appendFilterParams(baseUrl: string, json: string): TxnUrlStr {
  if (!URL.canParse(baseUrl)) return filterDataFallbackUrl(baseUrl, json);
  const url = new URL(baseUrl);
  url.searchParams.set('filterData', json);
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString() as TxnUrlStr;
}

/**
 * Builds a per-month transaction URL by setting `filterData` and
 * `firstCallCardIndex` on the captured base URL. Uses URL.searchParams
 * so existing query params (e.g. version, stale filterData) merge
 * correctly — concatenating with `?` produced a double-`?` URL when
 * the captured base already carried a query string, which Max's API
 * rejected with `result: null, returnCode: 10`.
 * @param baseUrl - captured transaction URL.
 * @param yyyy - calendar year.
 * @param m - calendar month (1-based, no zero-pad).
 * @returns full URL with encoded filterData + firstCallCardIndex.
 */
function buildFilterDataUrl(baseUrl: string, yyyy: number, m: number): TxnUrlStr {
  const json = buildFilterDataJson(yyyy, m);
  return appendFilterParams(baseUrl, json);
}

/**
 * Resolve the transaction URL for an account.
 * Priority: config path (validated) → discovered traffic → discovered transactionsUrl.
 * @param ctx - Bundled URL resolution context.
 * @returns Transaction URL or false.
 */
function resolveTxnUrl(ctx: ITxnUrlCtx): string | false {
  if (ctx.api.configTransactionsUrl) return ctx.api.configTransactionsUrl;
  const fromTemplate = ctx.network.buildTransactionUrl(ctx.accountId, ctx.startDate);
  if (fromTemplate) return fromTemplate;
  return ctx.api.transactionsUrl;
}

export { buildFilterDataUrl, resolveTxnUrl };
