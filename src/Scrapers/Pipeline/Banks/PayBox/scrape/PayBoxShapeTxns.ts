/**
 * PayBox scrape shape — wallet transactions helper. Wallet routes through
 * `/getUserHistory` (ts-cursor paginated, `{nc: [...]}`). Each raw row is
 * canonical-shaped by `mapWalletTxn` (split into PayBoxShapeMap.ts) so
 * the downstream `autoMapTransaction` keeps them. Pagination terminates
 * on empty page, on cursor stall, or at the server-imposed 24-page cap.
 * Rows an earlier page already covered are dropped before mapping —
 * see `dropCoveredRows` for why the server makes that necessary.
 */

import type {
  IExtractPageArgs,
  TxnsUrlTag,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { WKUrlGroup } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { buildAuthEnvelope } from './PayBoxAuthEnvelope.js';
import type { IPayBoxAcct } from './PayBoxShapeHelpers.js';
import type { IWalletTxnRaw } from './PayBoxShapeMap.js';
import { mapWalletTxn } from './PayBoxShapeMap.js';

/** Wallet pagination cap — PayBox server cuts off after ~24 pages. */
const WALLET_PAGE_CAP = 24;
/**
 * Initial ts cursor sent on the wallet's first /getUserHistory call.
 * The PayBox server expects the literal STRING `'null'` (not JSON
 * `null`, not the digit `'0'`) as the first-page marker; supplying any
 * other value returns an empty `nc` page.
 */
const WALLET_TS_FIRST = 'null';

/** Wallet ts cursor — opaque cursor string + zero-based page index. */
export interface IPayBoxCursor {
  readonly ts: string;
  readonly page: number;
}

/**
 * Wallet endpoint is fixed — every wallet account routes through
 * /getUserHistory. Exposed as the shape's `urlTag` producer.
 * @returns Constant WK URL group.
 */
export const TXNS_URL_TAG: TxnsUrlTag<IPayBoxAcct, IPayBoxCursor> = (): WKUrlGroup =>
  'data.getUserHistory';

/**
 * Resolve the active cursor for the wallet, defaulting to the first-
 * page sentinel `'null'` when the page reducer signals a cold start.
 * @param cursor - Incoming cursor (false on first call).
 * @returns Concrete wallet cursor.
 */
function walletCursorOf(cursor: IPayBoxCursor | false): IPayBoxCursor {
  if (cursor !== false) return cursor;
  return { ts: WALLET_TS_FIRST, page: 0 };
}

/**
 * Build txns variables — the full per-call body returned to the
 * dispatcher (bodyTemplate is omitted so vars IS the body).
 * @param _acct - PayBox account (unused — wallet endpoint is fixed).
 * @param cursor - Cursor (false on first call).
 * @param ctx - Action context.
 * @returns Body bundle (auth envelope + ts cursor).
 */
export function txnsVars(
  _acct: IPayBoxAcct,
  cursor: IPayBoxCursor | false,
  ctx: IActionContext,
): VarsMap {
  const walletCursor = walletCursorOf(cursor);
  return { auth: buildAuthEnvelope(ctx), ts: walletCursor.ts };
}

/**
 * Compute the next ts cursor — uses the oldest ts in the page to
 * advance, terminating when the page is empty, the cursor stalls, or
 * the page cap (24) is reached.
 * @param prev - Previous wallet cursor.
 * @param items - Raw items on the just-fetched page.
 * @returns Next cursor or `false` when pagination should stop.
 */
function nextWalletCursor(
  prev: IPayBoxCursor,
  items: readonly IWalletTxnRaw[],
): IPayBoxCursor | false {
  if (items.length === 0) return false;
  if (prev.page + 1 >= WALLET_PAGE_CAP) return false;
  const oldest = items.at(-1)?.ts;
  if (typeof oldest !== 'string' || oldest === prev.ts) return false;
  return { ts: oldest, page: prev.page + 1 };
}

/**
 * Decide whether a raw row lies strictly beyond the cursor boundary.
 * Rows whose `ts` cannot be parsed are kept — fail-open, because a
 * malformed timestamp is not evidence that the row is a duplicate.
 * @param ts - Raw row timestamp.
 * @param boundaryMs - Cursor timestamp as epoch milliseconds.
 * @returns True when the row still belongs on this page.
 */
function isBeyondCursor(ts: unknown, boundaryMs: number): boolean {
  const parsed = typeof ts === 'string' ? Date.parse(ts) : Number.NaN;
  if (Number.isNaN(parsed)) return true;
  return parsed < boundaryMs;
}

/**
 * Drop rows an earlier page already emitted.
 *
 * `/getUserHistory` does not reliably honour the `ts` cursor — it can
 * answer a later request with the previous page verbatim — while
 * `fetchPaginated` concatenates every page into the accumulator
 * unconditionally. Without this filter a re-served page emits each
 * transaction a second time (observed live: 88 rows for 44 distinct
 * transactions). Filtering also terminates pagination cleanly, because
 * an emptied page makes {@link nextWalletCursor} return `false`.
 * @param cursor - Cursor this page was requested with.
 * @param raws - Raw rows the server returned.
 * @returns Rows strictly older than the cursor; all rows on page 0.
 */
function dropCoveredRows(
  cursor: IPayBoxCursor,
  raws: readonly IWalletTxnRaw[],
): readonly IWalletTxnRaw[] {
  const boundaryMs = Date.parse(cursor.ts);
  if (cursor.page === 0 || Number.isNaN(boundaryMs)) return raws;
  return raws.filter((raw): boolean => isBeyondCursor(raw.ts, boundaryMs));
}

/**
 * Read the `content` block from a class-y response with no schema
 * assumption beyond it being an object.
 * @param resp - Response body.
 * @returns Content record (empty when absent / not an object).
 */
function readContent(resp: Record<string, unknown>): Record<string, unknown> {
  const content = resp.content;
  if (content === null || typeof content !== 'object') return {};
  return content as Record<string, unknown>;
}

/**
 * Extract one transactions page from a /getUserHistory response. Raw
 * rows are mapped to canonical ITransaction so `autoMapTransaction`
 * downstream recognises them.
 *
 * Signature matches the unified scrape-shape contract: takes a full
 * {@link IExtractPageArgs} bundle. PayBox uses `args.body` + `args.cursor`.
 * @param args - Bundle carrying body + cursor + acct + ctx.
 * @returns Mapped page rows + nextCursor.
 */
export function txnsExtractPage(
  args: IExtractPageArgs<IPayBoxAcct, IPayBoxCursor>,
): IPage<object, IPayBoxCursor> {
  const cursor = walletCursorOf(args.cursor);
  const content = readContent(args.body);
  const rawNc = content.nc;
  const served = (Array.isArray(rawNc) ? rawNc : []) as readonly IWalletTxnRaw[];
  const raws = dropCoveredRows(cursor, served);
  const mapped = raws.map(mapWalletTxn);
  const nextCursor = nextWalletCursor(cursor, raws);
  return { items: mapped, nextCursor };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_TXNS_INTERNALS = {
  nextWalletCursor,
  walletCursorOf,
  dropCoveredRows,
  buildAuthEnvelope,
  mapWalletTxn,
} as const;
