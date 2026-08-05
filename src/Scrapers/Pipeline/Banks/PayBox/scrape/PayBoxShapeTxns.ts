/**
 * PayBox scrape shape — wallet transactions helper. Wallet routes through
 * `/getUserHistory` (ts-cursor paginated, `{nc: [...]}`). Each raw row is
 * canonical-shaped by `mapWalletTxn` (split into PayBoxShapeMap.ts) so
 * the downstream `autoMapTransaction` keeps them. Pagination terminates
 * on empty page, on cursor stall, or at the server-imposed 24-page cap.
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
  const raws = (Array.isArray(rawNc) ? rawNc : []) as readonly IWalletTxnRaw[];
  const mapped = raws.map(mapWalletTxn);
  const nextCursor = nextWalletCursor(cursor, raws);
  return { items: mapped, nextCursor };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_TXNS_INTERNALS = {
  nextWalletCursor,
  walletCursorOf,
  buildAuthEnvelope,
  mapWalletTxn,
} as const;
