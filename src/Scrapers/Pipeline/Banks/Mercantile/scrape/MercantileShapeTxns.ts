/**
 * Mercantile scrape shape — transactions helpers. A single date-range
 * page against the Titan `/Date` endpoint (the full-history sibling of
 * the `/forHomePage` preview the generic pipeline used to hit). Raw
 * OperationEntry rows flow downstream to the field-mapping Data Mapper
 * unchanged. Split from MercantileShapeHelpers.ts to respect the 150-LOC
 * ceiling.
 *
 * Mercantile shares Discount's Titan tenant (start.telebank.co.il); the
 * `/Date` path + query params mirror the in-repo authoritative URL
 * builder (Mediator/Network/EndpointState `assembleTxnUrl`).
 */

import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { type IMercantileAcct, TITAN_API } from './MercantileShapeHelpers.js';

/** Titan full-history date format (YYYYMMDD, no separators). */
const TITAN_DATE_FMT = 'YYYYMMDD';

/** Fixed query flags for the full-history `/Date` endpoint. */
const FULL_TXN_QUERY =
  'IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True';

type MercantileTxn = Record<string, unknown>;

interface ITxnsResp {
  readonly CurrentAccountLastTransactions?: { readonly OperationEntry?: readonly MercantileTxn[] };
}

/**
 * Scrape-window start date (YYYYMMDD from ScraperOptions.startDate).
 * File-internal helper (not a module boundary) — plain string is fine.
 *
 * <p>Read in the bank's zone, not the host's. The caller supplies an instant;
 * the provider expects the bank-calendar day it falls on. Formatting it
 * ambiently names the previous day west of Israel (harmless over-fetch) and
 * the *next* day east of it — which never asks for the caller's first day and
 * leaves a gap no backfill can close, because the gap is at the far end.
 *
 * @param ctx - Action context.
 * @returns Formatted FromDate.
 */
function fromDateOf(ctx: IActionContext): string {
  return bankMomentOfInstant(ctx.options.startDate).format(TITAN_DATE_FMT);
}

/**
 * Transactions URL — {accountId}/Date?<flags>&FromDate=YYYYMMDD.
 * @param acct - Mercantile account.
 * @param _cursor - Unused (single-page date range).
 * @param ctx - Action context (carries startDate).
 * @returns Literal Titan full-history URL.
 */
export function txnsUrl(
  acct: IMercantileAcct,
  _cursor: false,
  ctx: IActionContext,
): WKUrlOrLiteral {
  const path = `${TITAN_API}/lastTransactions/transactions/${acct.accountId}/Date`;
  return literalUrl(`${path}?${FULL_TXN_QUERY}&FromDate=${fromDateOf(ctx)}`);
}

/**
 * Extract the single transactions page — raw OperationEntry rows, no
 * next cursor (the date-range endpoint returns the whole window).
 * @param args - Bundle carrying the unwrapped response body.
 * @returns Page rows + terminal cursor.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IMercantileAcct, never>,
): IPage<object, never> {
  const resp = args.body as unknown as ITxnsResp;
  const rows = resp.CurrentAccountLastTransactions?.OperationEntry ?? [];
  return { items: rows, nextCursor: false };
}

/**
 * No-op variables builder — the `/Date` GET carries all params in URL.
 * @returns Empty variables map.
 */
export function txnsVars(): VarsMap {
  return {};
}
