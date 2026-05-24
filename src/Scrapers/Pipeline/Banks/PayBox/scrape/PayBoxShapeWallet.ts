/**
 * PayBox wallet-account scrape helpers.
 *
 * The wallet account derives from POST /getUserHistory rows
 * (PbNotification objects). Pagination is driven by a `ts` cursor:
 * '0' on the first call; the oldest row's ts on subsequent calls.
 * Termination: empty page / stall (no progress) / cap at 24 pages
 * per spec.txt §6.4.
 */

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import { type IPbNotification, mapAmountSign, mapPbStat } from './PayBoxShapeHelpers.js';

/** Cursor shape for the wallet pagination loop. */
export interface IPayBoxWalletCursor {
  readonly kind: 'wallet';
  readonly ts: string;
  readonly page: number;
}

/** Discriminator for the wallet account variant. */
export interface IPayBoxWalletAcct {
  readonly kind: 'wallet';
  readonly accountNumber: string;
}

/** First-call ts cursor literal (server contract). */
const FIRST_TS = '0';

/** Hard ceiling on wallet pagination per spec.txt §6.4(c). */
const WALLET_PAGE_CAP = 24;

/** /getUserHistory response shape (cleartext envelope). */
interface IUserHistoryResp {
  readonly code?: number;
  readonly content?: {
    readonly nc?: readonly IPbNotification[];
    readonly idMatch?: boolean;
  };
}

/**
 * Build the request variables for one /getUserHistory page. The
 * ts cursor is sent as a string per the server contract.
 *
 * @param cursor - Cursor returned by the previous page, or false on first call.
 * @returns Variables map for the page.
 */
export function walletBuildVars(cursor: IPayBoxWalletCursor | false): VarsMap {
  const ts = cursor === false ? FIRST_TS : cursor.ts;
  return { ts };
}

/**
 * Compare two ts strings via String.localeCompare.
 *
 * @param a - First ts.
 * @param b - Second ts.
 * @returns Standard compare result.
 */
function compareTs(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Read the ts field off one row — used as a map projection.
 *
 * @param row - Notification row.
 * @returns The ts string.
 */
function rowTs(row: IPbNotification): string {
  return row.ts;
}

/**
 * Pick the oldest ts among the non-empty rows on a page
 * (lexicographic compare via String.localeCompare; ts values are
 * left-padded decimal strings of equal width so the result is
 * numerically stable).
 *
 * Precondition: caller guarantees rows.length > 0 (callers branch
 * on emptiness before invoking this helper).
 *
 * @param rows - Non-empty rows from the page.
 * @returns Oldest ts string.
 */
function oldestTs(rows: readonly IPbNotification[]): string {
  const tsList = rows.map(rowTs);
  const sorted = [...tsList].sort(compareTs);
  return sorted[0];
}

/**
 * Determine the next cursor or stop signal based on pagination
 * rules (a) empty, (b) stall, (c) cap.
 *
 * @param rows - Rows returned on the just-fetched page.
 * @param cursor - Cursor used to fetch this page.
 * @returns Next cursor or false to stop.
 */
function walletNextCursor(
  rows: readonly IPbNotification[],
  cursor: IPayBoxWalletCursor | false,
): IPayBoxWalletCursor | false {
  if (rows.length === 0) return false;
  const nextTs = oldestTs(rows);
  const prevPage = cursor === false ? 0 : cursor.page;
  const prevTs = cursor === false ? '' : cursor.ts;
  if (nextTs === prevTs) return false;
  if (prevPage + 1 >= WALLET_PAGE_CAP) return false;
  return { kind: 'wallet', ts: nextTs, page: prevPage + 1 };
}

/**
 * Extract one wallet page — return rows with normalised
 * transaction fields plus the cursor for the next page.
 *
 * @param body - Unwrapped /getUserHistory response.
 * @param cursor - Cursor used for this request.
 * @returns Page rows + nextCursor signal.
 */
export function walletExtractPage(
  body: ApiBody,
  cursor: IPayBoxWalletCursor | false,
): IPage<object, IPayBoxWalletCursor> {
  const resp = body as unknown as IUserHistoryResp;
  const rows = resp.content?.nc ?? [];
  const mapped = rows.map(toWalletTransaction);
  const nextCursor = walletNextCursor(rows, cursor);
  return { items: mapped, nextCursor };
}

/**
 * Resolve transaction identifier — falls back through transactionId
 * → _id → empty string.
 *
 * @param row - Source notification row.
 * @returns Identifier value.
 */
function rowIdentifier(row: IPbNotification): string {
  return row.transactionId ?? row._id ?? '';
}

/**
 * Resolve human description — merchantName preferred over text.
 *
 * @param row - Source notification row.
 * @returns Description string.
 */
function rowDescription(row: IPbNotification): string {
  return row.merchantName ?? row.text ?? '';
}

/**
 * Sentinel ISO date returned when an upstream `ts` value cannot be
 * parsed — guards `toISOString()` against the `RangeError` it throws
 * for invalid Date objects.
 */
const EPOCH_ISO = new Date(0).toISOString();

/**
 * Parse a wallet row's `ts` (epoch-ms string) defensively. Malformed
 * upstream values fall back to {@link EPOCH_ISO} so `toISOString()`
 * cannot throw `RangeError` and abort the whole scrape.
 * @param raw - Raw `ts` string from the row.
 * @returns ISO-8601 string.
 */
function safeWalletIso(raw: string): string {
  const millis = Number.parseInt(raw, 10);
  const parsed = new Date(millis);
  const ts = parsed.getTime();
  if (Number.isNaN(ts)) return EPOCH_ISO;
  return parsed.toISOString();
}

/**
 * Map one PbNotification to a transaction record consumed by the
 * generic scrape driver. The driver expects a plain object with
 * the standard ITransaction shape — sign convention applied via
 * mapAmountSign.
 *
 * @param row - One row from content.nc.
 * @returns Plain transaction object.
 */
function toWalletTransaction(row: IPbNotification): object {
  const date = safeWalletIso(row.ts);
  return {
    identifier: rowIdentifier(row),
    date,
    processedDate: date,
    originalAmount: row.amount,
    originalCurrency: row.transactionCurrency ?? 'ILS',
    chargedAmount: mapAmountSign(row.amount, row.type),
    description: rowDescription(row),
    status: mapPbStat(row.stat),
    memo: row.comment ?? '',
  };
}
