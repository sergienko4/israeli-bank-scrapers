/**
 * OneZero scrape shape — transactions helpers (cursor, pagination, stop).
 * Split from OneZeroShapeHelpers.ts to respect the 150-LOC per-file ceiling.
 */

import moment from 'moment';

import {
  type CursorWireValue,
  FIRST_PAGE_CURSOR_WIRE,
} from '../../../Mediator/Scrape/CursorPagination.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { ApiBody, VarsMap } from '../../_Shared/HeadlessScrapeShape.js';
import type { IOneZeroAcct } from './OneZeroShapeHelpers.js';

const MOVEMENTS_LIMIT = 50;
const LANGUAGE = 'HEBREW';

/** Whether pagination should stop once the oldest row pre-dates the window. */
type ShouldStopPagination = boolean;

type OneZeroTxn = Record<string, unknown>;

interface IMovResp {
  readonly movements: {
    readonly movements: readonly OneZeroTxn[];
    readonly pagination: { readonly cursor: string | null; readonly hasMore: boolean };
  };
}

/**
 * Pick nextCursor from the GraphQL pagination block.
 * @param hasMore - hasMore flag from the response.
 * @param cursor - Incoming cursor (may be empty).
 * @returns Cursor string or false when exhausted.
 */
function pickNextCursor(hasMore: boolean, cursor: string | false): string | false {
  if (!hasMore) return false;
  if (cursor === false) return false;
  if (cursor === '') return false;
  return cursor;
}

/**
 * Wire cursor value for the next apiQuery.
 * @param cursor - Current cursor (false on first page).
 * @returns Wire cursor.
 */
function wireCursor(cursor: string | false): CursorWireValue | string {
  if (cursor === false) return FIRST_PAGE_CURSOR_WIRE;
  return cursor;
}

/**
 * Build movements-query variables for one page.
 * @param acct - Account ref.
 * @param cursor - Cursor (false on first call).
 * @returns Variables map.
 */
export function txnsVars(acct: IOneZeroAcct, cursor: string | false): VarsMap {
  const base = { portfolioId: acct.portfolioId, accountId: acct.accountId, language: LANGUAGE };
  const pagination = { cursor: wireCursor(cursor), limit: MOVEMENTS_LIMIT };
  return { ...base, pagination };
}

/**
 * Unwrap one movements page into the generic IPage contract.
 * @param body - Unwrapped movements response.
 * @returns Page rows + nextCursor.
 */
export function txnsExtractPage(body: ApiBody): IPage<object, string> {
  const resp = body as unknown as IMovResp;
  const { movements, pagination } = resp.movements;
  const cursorIn: string | false = pagination.cursor ?? false;
  const nextCursor = pickNextCursor(pagination.hasMore, cursorIn);
  return { items: movements, nextCursor };
}

/**
 * Compute start-date threshold — max(options.startDate, 1y ago).
 * @param ctx - Action context.
 * @returns Start-date threshold.
 */
function resolveStartDate(ctx: IActionContext): Date {
  const defStart = moment().subtract(1, 'years').add(1, 'day');
  const optStart = moment(ctx.options.startDate);
  return moment.max(defStart, optStart).toDate();
}

/**
 * Stop pagination when the oldest movement predates the window.
 * @param acc - Accumulator collected so far.
 * @param ctx - Action context.
 * @returns True when pagination should stop.
 */
export function stopPredicate(acc: readonly object[], ctx: IActionContext): ShouldStopPagination {
  if (acc.length === 0) return false;
  const last = acc.at(-1) as OneZeroTxn | undefined;
  const raw = last?.movementTimestamp;
  if (typeof raw !== 'string') return false;
  if (raw === '') return false;
  return new Date(raw) < resolveStartDate(ctx);
}
