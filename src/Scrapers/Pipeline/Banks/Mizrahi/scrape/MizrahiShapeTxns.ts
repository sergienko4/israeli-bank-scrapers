/**
 * Mizrahi scrape shape — transactions helpers. `SkyOSH/get428Index` in its
 * "between dates" (בין תאריכים) mode (plan D13): the same endpoint and body
 * every period option of the SPA sends, with the window in
 * `inFromDate`/`inToDate` as `DD/MM/YYYY` bank-calendar days.
 *
 * <p>The server serves 365 days back from today: an older `inFromDate` gets
 * HTTP 500 however short the range (real logins #9 and #13; the UI picker
 * stops at a year too). So the start is clamped to today − 365 days. The floor
 * is pinned to the clock, not to the window end: a backfill round narrows only
 * `inToDate`, keeps the floor, and so never asks for a refused day. A round
 * whose bound falls before the floor (bank midnight passed between rounds, or
 * a row predates `inFromDate`) asks for the floor day alone rather than an
 * inverted range the server answers with HTTP 500: that day is already held,
 * so the bound stops moving and the backfill ends. That clock
 * read is why this file is excluded from the window-end lint rule
 * (eslint.config.mjs §20). Older days are reported by the shared
 * window-coverage audit, never dropped silently.
 *
 * <p>Pages hold 50 rows. While `table.isHasMoreRows` is true, the next page
 * asks from the next row index and echoes the server's `actionGUID`.
 *
 * <p>The table holds a balance header row and section-label rows beside the
 * transactions; only rows with `RecTypeSpecified` are transactions (the
 * filter the legacy scraper used). Rows flow downstream to the field-mapping
 * Data Mapper unchanged but for the legacy identifier (MizrahiShapeIdentifier).
 *
 * <p>The call serves the session's current account, which the balance step
 * switched to (MizrahiShapeBalance, plan D17). The driver runs that switch,
 * then this account's first walk and every backfill round, before the next
 * account's switch. `fields.AccountNumber` names the account only when the
 * range reaches today; a backfill round ending earlier, a later page and a
 * night reply all come back without `fields` (real login #14). So a page
 * naming another account fails the scrape, and an unnamed page passes.
 */

import ScraperError from '../../../../Base/ScraperError.js';
import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import { scrapeWindowEnd } from '../../../Mediator/Scrape/ScrapeWindowEnd.js';
import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { type IMizrahiAcct, MIZRAHI_API } from './MizrahiShapeHelpers.js';
import { type MizrahiRow, withIdentifier } from './MizrahiShapeIdentifier.js';

/** Wire date format of `inFromDate` / `inToDate`. */
const MIZRAHI_DATE_FMT = 'DD/MM/YYYY';
/** Days of history the server serves, counted back from today. */
const HISTORY_DAYS = 365;
/** Page size the SPA asks for (the server pages at 50 rows). */
const PAGE_SIZE = 50;
/** Raised when a page belongs to an account other than the one scraped. */
const FOREIGN_PAGE = 'Mizrahi get428Index page belongs to another account';
/** Raised when the server offers more rows without a continuation id. */
const NO_ACTION_GUID = 'Mizrahi get428Index offers more rows without an actionGUID';

/** Paging position: the next row index plus the server's result-set id. */
export interface IMizrahiCursor {
  readonly startRowIndex: number;
  readonly actionGuid: string;
}

/** The first page's position. */
const FIRST_PAGE: IMizrahiCursor = { startRowIndex: 0, actionGuid: '' };

/**
 * The paging position a cursor stands for.
 * @param cursor - Paging position (false on the first page).
 * @returns The cursor, or {@link FIRST_PAGE} on the first page.
 */
function positionOf(cursor: IMizrahiCursor | false): IMizrahiCursor {
  return cursor === false ? FIRST_PAGE : cursor;
}

/** The `get428Index` response subset the shape reads. */
interface ITxnsResp {
  readonly body?: {
    readonly fields?: { readonly AccountNumber?: string } | null;
    readonly table?: {
      readonly rows?: readonly MizrahiRow[];
      readonly actionGUID?: string;
      readonly isHasMoreRows?: boolean;
    };
  };
}

/**
 * Whether a `table.rows[]` entry is a transaction. The balance line (dated
 * today, the balance as its amount) and the section labels carry no
 * `RecTypeSpecified`. The extractor filters with it and the shape declares it
 * as `auditIsTxnRow`, so the coverage audit never counts the balance line.
 * @param row - Raw row.
 * @returns Whether the row is a transaction.
 */
export const IS_MIZRAHI_TXN_ROW = (row: object): boolean =>
  (row as MizrahiRow).RecTypeSpecified === true;

/**
 * Transactions URL — the account-movements endpoint.
 * @returns Literal transactions URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${MIZRAHI_API}/SkyOSH/get428Index`);
}

/** One request's window, as instants rendered to bank days on the wire. */
interface IRequestRange {
  readonly rangeStart: Date;
  readonly rangeEnd: Date;
}

/**
 * The request's window: the caller's start capped at the window end and
 * floored at today − {@link HISTORY_DAYS}, and an end never before that start.
 * A backfill bound that falls before the floor (bank midnight passed between
 * rounds, or a row predates `inFromDate`) so asks for the floor day alone.
 * @param ctx - Action context (carries startDate).
 * @param windowEnd - The request's window end.
 * @returns A range whose start is ≤ its end and ≥ the floor.
 */
function requestRange(ctx: IActionContext, windowEnd: Date): IRequestRange {
  const now = new Date();
  const floor = bankMomentOfInstant(now).subtract(HISTORY_DAYS, 'days').toDate();
  const optionStart = ctx.options.startDate;
  const asked = optionStart > windowEnd ? windowEnd : optionStart;
  const rangeStart = floor > asked ? floor : asked;
  const rangeEnd = rangeStart > windowEnd ? rangeStart : windowEnd;
  return { rangeStart, rangeEnd };
}

/**
 * Transactions-step vars — the SPA's between-dates body for one page.
 * @param _acct - Unused (the balance step switched the session to it).
 * @param cursor - Paging position (false on the first page).
 * @param ctx - Action context (carries startDate and the window end).
 * @returns get428Index request body.
 */
export function txnsVars(
  _acct: IMizrahiAcct,
  cursor: IMizrahiCursor | false,
  ctx: IActionContext,
): VarsMap {
  const windowEnd = scrapeWindowEnd(ctx);
  const { rangeStart, rangeEnd } = requestRange(ctx, windowEnd);
  const inFromDate = bankMomentOfInstant(rangeStart).format(MIZRAHI_DATE_FMT);
  const inToDate = bankMomentOfInstant(rangeEnd).format(MIZRAHI_DATE_FMT);
  const { startRowIndex, actionGuid } = positionOf(cursor);
  const table = { startRowIndex, maxRow: PAGE_SIZE, actionGuid, sortExpression: '' };
  return { inToDate, inFromDate, inSugTnua: '', table, isFromSearch: false };
}

/**
 * Fail when the page names an account other than the one scraped.
 * @param args - Bundle carrying the raw response body and account.
 * @param items - The page's transaction rows.
 * @returns The rows, unchanged.
 * @throws ScraperError when the page names another account.
 */
function ownedRows(
  args: IExtractPageArgs<IMizrahiAcct, IMizrahiCursor>,
  items: readonly MizrahiRow[],
): readonly MizrahiRow[] {
  const owner = (args.body as ITxnsResp).body?.fields?.AccountNumber;
  if (owner === undefined || owner === args.acct.accountNumber) return items;
  throw new ScraperError(FOREIGN_PAGE);
}

/**
 * The next page's position, or false when the server has no more rows.
 * @param cursor - This page's position (false on the first page).
 * @param resp - This page's response.
 * @returns Next cursor, or false when exhausted.
 * @throws ScraperError when more rows are offered without an actionGUID.
 */
function nextCursorOf(cursor: IMizrahiCursor | false, resp: ITxnsResp): IMizrahiCursor | false {
  const table = resp.body?.table;
  if (table?.isHasMoreRows !== true) return false;
  const actionGuid = table.actionGUID ?? '';
  if (actionGuid === '') throw new ScraperError(NO_ACTION_GUID);
  const { startRowIndex } = positionOf(cursor);
  return { startRowIndex: startRowIndex + PAGE_SIZE, actionGuid };
}

/**
 * Extract the transaction rows of one page.
 * @param args - Bundle carrying the raw response body, cursor and account.
 * @returns Transaction rows + the next cursor.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IMizrahiAcct, IMizrahiCursor>,
): IPage<object, IMizrahiCursor> {
  const resp = args.body as ITxnsResp;
  const rows = resp.body?.table?.rows ?? [];
  const txns = rows.filter(IS_MIZRAHI_TXN_ROW);
  const owned = ownedRows(args, txns);
  const items = owned.map(withIdentifier);
  return { items, nextCursor: nextCursorOf(args.cursor, resp) };
}
