/**
 * Pepper scrape shape — transactions helpers (cursor, pagination merge).
 * Split from PepperShapeHelpers.ts to respect the 150-LOC ceiling.
 */

import moment from 'moment';

import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { ApiBody, VarsMap } from '../../_Shared/HeadlessScrapeShape.js';
import type { IPepperAcct } from './PepperShapeHelpers.js';

const ISO_DATE_FMT = 'YYYY-MM-DD';
/** Page-size limit for transactions pagination. */
export const PAGE_SIZE = 100;
const FIRST_PAGE = 1;

/** 1-based pagination page number. */
type PageNumber = number;
/** Whether pagination should terminate after the current page. */
type IsLastPage = boolean;

type PepperTxn = Record<string, unknown>;

interface IOshBlock {
  readonly totalCount?: number;
  readonly transactions?: readonly PepperTxn[];
  readonly pendingTransactions?: readonly PepperTxn[];
}
interface ITxnsResp {
  readonly accounts?: { readonly oshTransactionsNew?: IOshBlock };
}

/** Scrape window (from/to ISO strings). */
export interface IWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * Compute the scrape window from ScraperOptions.startDate.
 * @param ctx - Action context.
 * @returns from/to ISO strings.
 */
export function windowOf(ctx: IActionContext): IWindow {
  const from = moment(ctx.options.startDate).format(ISO_DATE_FMT);
  const to = moment().format(ISO_DATE_FMT);
  return { from, to };
}

/**
 * Resolve the 1-based page number for the request.
 * @param cursor - Incoming cursor (false on first call).
 * @returns Page number.
 */
export function pageNumberOf(cursor: number | false): PageNumber {
  if (cursor === false) return FIRST_PAGE;
  return cursor;
}

/**
 * Build txns variables for one page.
 * @param acct - Pepper account.
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context.
 * @returns Variables map.
 */
export function txnsVars(acct: IPepperAcct, cursor: number | false, ctx: IActionContext): VarsMap {
  const window = windowOf(ctx);
  const pageNumber = pageNumberOf(cursor);
  const { accountId } = acct;
  return { accountId, from: window.from, to: window.to, pageNumber, pageCount: PAGE_SIZE };
}

/**
 * Terminate when empty, under-page, or cumulative coverage meets totalCount.
 * @param rows - Rows on the current page.
 * @param page - Page number just fetched.
 * @param total - Server-declared totalCount.
 * @returns True when pagination should stop.
 */
export function isLastPage(rows: number, page: number, total: number): IsLastPage {
  if (rows === 0) return true;
  if (rows < PAGE_SIZE) return true;
  return page * PAGE_SIZE >= total;
}

/**
 * Resolve next cursor — false when done, else page+1.
 * @param isDone - Whether pagination should stop after this page.
 * @param page - Page number just fetched.
 * @returns Next cursor value.
 */
function nextCursorOf(isDone: boolean, page: number): number | false {
  if (isDone) return false;
  return page + 1;
}

/**
 * Merge posted + pending rows into one page.
 * @param osh - Optional oshTransactionsNew block.
 * @returns Merged rows (empty when block is missing).
 */
function mergeRows(osh?: IOshBlock): readonly PepperTxn[] {
  const posted = osh?.transactions ?? [];
  const pending = osh?.pendingTransactions ?? [];
  return [...posted, ...pending];
}

/**
 * Extract one page from the unwrapped Transactions response.
 * @param body - Unwrapped Transactions response.
 * @param cursor - Cursor used for this request.
 * @returns Page rows + nextCursor.
 */
export function txnsExtractPage(body: ApiBody, cursor: number | false): IPage<object, number> {
  const resp = body as unknown as ITxnsResp;
  const osh = resp.accounts?.oshTransactionsNew;
  const rows = mergeRows(osh);
  const page = pageNumberOf(cursor);
  const total = osh?.totalCount ?? 0;
  const isDone = isLastPage(rows.length, page, total);
  return { items: rows, nextCursor: nextCursorOf(isDone, page) };
}
