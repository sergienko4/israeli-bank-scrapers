/**
 * PayBox debit-account scrape helpers.
 *
 * The debit account derives from POST /virtualCardTranRequest rows
 * (filteredTransactions). Date-range chunking: 180-day windows
 * stepping from creds.startDate to now per spec.txt §6.5.
 */

import moment from 'moment';

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { type IDebitTxn, mapDebitStatus } from './PayBoxShapeHelpers.js';

/** Cursor shape for the debit chunking loop. */
export interface IPayBoxDebitCursor {
  readonly kind: 'debit';
  readonly startDate: Date;
  readonly endDate: Date;
}

/** Discriminator for the debit account variant. */
export interface IPayBoxDebitAcct {
  readonly kind: 'debit';
  readonly accountNumber: string;
}

/** Chunk length per pagination iteration — ~6 months per spec.txt §6.5. */
const CHUNK_DAYS = 180;

/** Date-format token used to serialise startDate / endDate. */
const YMD_FORMAT = 'YYYY-MM-DD';

/** /virtualCardTranRequest response shape (cleartext envelope). */
interface IDebitResp {
  readonly code?: number;
  readonly content?: {
    readonly filteredTransactions?: readonly IDebitTxn[];
  };
}

/**
 * Compute the chunk window: [startDate, startDate + CHUNK_DAYS]
 * capped at now. Used both on first call (cursor=false) and on
 * subsequent calls (cursor carries the next window).
 *
 * @param baseStart - Earliest date to scrape from.
 * @returns Initial cursor for the chunk loop.
 */
function initialDebitCursor(baseStart: Date): IPayBoxDebitCursor {
  const start = moment(baseStart);
  const now = moment();
  const tentativeEnd = start.clone().add(CHUNK_DAYS, 'days');
  const cappedEnd = moment.min(tentativeEnd, now).toDate();
  return { kind: 'debit', startDate: start.toDate(), endDate: cappedEnd };
}

/**
 * Build request variables for one chunk. Dates emit as
 * YYYY-MM-DD strings per spec.txt §6.5.
 *
 * @param cursor - Cursor for this chunk, or false on first call.
 * @param ctx - Action context (carries the user-supplied startDate).
 * @returns Variables map for the chunk.
 */
export function debitBuildVars(cursor: IPayBoxDebitCursor | false, ctx: IActionContext): VarsMap {
  const effective = cursor === false ? initialDebitCursor(ctx.options.startDate) : cursor;
  return {
    startDate: moment(effective.startDate).format(YMD_FORMAT),
    endDate: moment(effective.endDate).format(YMD_FORMAT),
  };
}

/**
 * Determine the next chunk cursor or stop signal.
 *
 * @param cursor - Cursor used to fetch this chunk.
 * @returns Next cursor, or false when the window reached now.
 */
function debitNextCursor(cursor: IPayBoxDebitCursor): IPayBoxDebitCursor | false {
  const nextStart = moment(cursor.endDate).add(1, 'days');
  const now = moment();
  if (!nextStart.isBefore(now)) return false;
  const tentativeEnd = nextStart.clone().add(CHUNK_DAYS, 'days');
  const cappedEnd = moment.min(tentativeEnd, now).toDate();
  return { kind: 'debit', startDate: nextStart.toDate(), endDate: cappedEnd };
}

/**
 * Resolve the cursor actually used for this fetch — when the driver
 * passes `false` (first call), the effective window is the one that
 * `debitBuildVars` synthesised from ctx.options.startDate. Recreate it
 * here so the next-cursor decision can step past the first chunk.
 *
 * @param baseStart - User-supplied start date (ctx.options.startDate).
 * @param cursor - Cursor passed to debitExtractPage.
 * @returns Concrete cursor representing the window we just fetched.
 */
function effectiveDebitCursor(
  baseStart: Date,
  cursor: IPayBoxDebitCursor | false,
): IPayBoxDebitCursor {
  return cursor === false ? initialDebitCursor(baseStart) : cursor;
}

/**
 * Extract one debit chunk — return rows with normalised
 * transaction fields plus the cursor for the next chunk. The
 * 180-day loop terminates naturally when the next window would
 * start at or after today (debitNextCursor returns false).
 *
 * @param body - Unwrapped /virtualCardTranRequest response.
 * @param cursor - Cursor used for this request.
 * @param ctx - Action context (carries the user-supplied startDate).
 * @returns Page rows + nextCursor signal.
 */
export function debitExtractPage(
  body: ApiBody,
  cursor: IPayBoxDebitCursor | false,
  ctx: IActionContext,
): IPage<object, IPayBoxDebitCursor> {
  const resp = body as unknown as IDebitResp;
  const rows = resp.content?.filteredTransactions ?? [];
  const mapped = rows.map(toDebitTransaction);
  const effective = effectiveDebitCursor(ctx.options.startDate, cursor);
  return { items: mapped, nextCursor: debitNextCursor(effective) };
}

/**
 * Sentinel ISO date returned when an upstream `date` value cannot be
 * parsed — guards `toISOString()` against the `RangeError` it throws
 * for invalid Date objects.
 */
const EPOCH_ISO = new Date(0).toISOString();

/**
 * Parse a row's `date` field, falling back to {@link EPOCH_ISO} when
 * the upstream value is unparseable.
 * @param raw - Raw `date` string from the row.
 * @returns ISO-8601 string.
 */
function safeIsoDate(raw: string): string {
  const parsed = new Date(raw);
  const ts = parsed.getTime();
  if (Number.isNaN(ts)) return EPOCH_ISO;
  return parsed.toISOString();
}

/**
 * Map one filteredTransactions row to a transaction record.
 *
 * @param row - One row from content.filteredTransactions.
 * @returns Plain transaction object.
 */
function toDebitTransaction(row: IDebitTxn): object {
  const date = safeIsoDate(row.date);
  return {
    identifier: String(row.id),
    date,
    processedDate: date,
    originalAmount: row.amount,
    originalCurrency: row.currency ?? 'ILS',
    chargedAmount: row.amount,
    description: row.merchantName ?? '',
    status: mapDebitStatus(row.status),
    memo: row.description ?? '',
  };
}
