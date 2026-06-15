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
  const dateStr = `${String(yyyy)}-${String(m)}-01`;
  const json = JSON.stringify(FILTER_DATA_TEMPLATE).replace('{date}', dateStr);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    const encoded = encodeURIComponent(json);
    return `${baseUrl}?filterData=${encoded}&firstCallCardIndex=-1` as TxnUrlStr;
  }
  url.searchParams.set('filterData', json);
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString() as TxnUrlStr;
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
