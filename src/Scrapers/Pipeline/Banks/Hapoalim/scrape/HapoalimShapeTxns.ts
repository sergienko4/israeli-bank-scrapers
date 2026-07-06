/**
 * Hapoalim scrape shape — transactions helpers. A single full-window
 * POST against `current-account/transactions` (all params ride the query
 * string; the body is an empty container). Raw rows flow downstream to
 * the field-mapping Data Mapper unchanged. Split from
 * HapoalimShapeHelpers.ts to respect the 150-LOC ceiling.
 *
 * Anti-replay contract (upstream `fetchPoalimXSRFWithinPage` + captured
 * trace 0073): Hapoalim rejects the POST unless the request echoes the
 * `XSRF-TOKEN` cookie as the `X-XSRF-TOKEN` header, carries the fixed
 * `pageUuid`, a fresh `uuid`, and the exact `content-type`. The
 * `@cookie:` sentinel is resolved from the live login session by
 * BrowserFetchStrategy at dispatch time.
 *
 * Wire body note: the SPA POSTs `[]` (empty array); the hard-model
 * dispatch path is object-typed, so it sends `{}`. Both serialise to an
 * empty JSON container and the endpoint reads every parameter from the
 * query string, so the two are equivalent for this call.
 */

import { randomUUID } from 'node:crypto';

import moment from 'moment';

import type {
  HeaderMap,
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { COOKIE_HEADER_SENTINEL_PREFIX } from '../../../Strategy/Fetch/CookieHeaderSentinel.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { HAPOALIM_API, type IHapoalimAcct } from './HapoalimShapeHelpers.js';

/** Retrieval date format (YYYYMMDD, no separators). */
const HAPOALIM_DATE_FMT = 'YYYYMMDD';
/** Single full-window page size (upstream numItemsPerPage). */
const TXN_PAGE_SIZE = '1000';
/** Fixed anti-replay pageUuid (upstream fetchPoalimXSRFWithinPage). */
const TXN_PAGE_UUID = '/current-account/transactions';
/** X-XSRF-TOKEN header value — cookie-echo sentinel resolved at dispatch. */
const XSRF_HEADER_VALUE = `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`;

type HapoalimTxn = Record<string, unknown>;

interface ITxnsResp {
  readonly transactions?: readonly HapoalimTxn[];
}

/**
 * Retrieval start date (YYYYMMDD from ScraperOptions.startDate).
 * @param ctx - Action context.
 * @returns Formatted retrievalStartDate.
 */
function startOf(ctx: IActionContext): string {
  return moment(ctx.options.startDate).format(HAPOALIM_DATE_FMT);
}

/**
 * Retrieval end date (YYYYMMDD — today, upstream parity).
 * @returns Formatted retrievalEndDate.
 */
function endOf(): string {
  return moment().format(HAPOALIM_DATE_FMT);
}

/**
 * Transactions URL — full-window query against current-account/transactions.
 * @param acct - Hapoalim account.
 * @param _cursor - Unused (single full-window call).
 * @param ctx - Action context (carries startDate).
 * @returns Literal transactions URL.
 */
export function txnsUrl(acct: IHapoalimAcct, _cursor: false, ctx: IActionContext): WKUrlOrLiteral {
  const base = `${HAPOALIM_API}/current-account/transactions`;
  const range = `retrievalEndDate=${endOf()}&retrievalStartDate=${startOf(ctx)}`;
  const paging = `numItemsPerPage=${TXN_PAGE_SIZE}&sortCode=1`;
  const tail = `accountId=${acct.composite}&lang=he`;
  return literalUrl(`${base}?${paging}&${range}&${tail}`);
}

/**
 * Anti-replay header set — cookie-echo XSRF token, fixed pageUuid, fresh
 * uuid, and the exact content-type Hapoalim requires for the POST.
 * @returns Per-call header map.
 */
export function txnsHeaders(): HeaderMap {
  return {
    'content-type': 'application/json;charset=UTF-8',
    'X-XSRF-TOKEN': XSRF_HEADER_VALUE,
    pageUuid: TXN_PAGE_UUID,
    uuid: randomUUID(),
  };
}

/**
 * Extract the single transactions page — raw rows, no next cursor (the
 * full-window call returns the whole range).
 * @param args - Bundle carrying the unwrapped response body.
 * @returns Page rows + terminal cursor.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IHapoalimAcct, never>,
): IPage<object, never> {
  const resp = args.body as unknown as ITxnsResp;
  const rows = resp.transactions ?? [];
  return { items: rows, nextCursor: false };
}

/**
 * No-op variables builder — the POST body is an empty container; all
 * params ride the URL query string.
 * @returns Empty variables map.
 */
export function txnsVars(): VarsMap {
  return {};
}
