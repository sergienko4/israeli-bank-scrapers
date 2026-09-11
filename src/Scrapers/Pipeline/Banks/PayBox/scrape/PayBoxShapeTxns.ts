/**
 * PayBox scrape shape — wallet transactions helper. Wallet routes through
 * `/getUserHistory` (ts-cursor paginated, `{nc: [...]}`). Each raw row is
 * canonical-shaped by `mapWalletTxn` (split into PayBoxShapeMap.ts) so
 * the downstream `autoMapTransaction` keeps them. Pagination terminates
 * on empty page, on cursor stall, or at the local 24-page safety cap.
 * Rows an earlier page already covered are dropped before mapping —
 * see `dropCoveredRows` for why the server makes that necessary.
 */

import ScraperError from '../../../../Base/ScraperError.js';
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
import walletPagination from './PayBoxWalletPagination.js';

/** Wallet ts cursor — opaque cursor string + zero-based page index. */
export interface IPayBoxCursor {
  readonly ts: string;
  readonly page: number;
  /** Identities at the boundary that the next page may re-serve. */
  readonly seenIds?: readonly string[];
}

/**
 * Resolve PayBox's first-page marker behind the public cursor type.
 * @param cursor - Incoming cursor, or false on the first call.
 * @returns Concrete wallet cursor.
 */
function walletCursorOf(cursor: IPayBoxCursor | false): IPayBoxCursor {
  return walletPagination.walletCursorOf(cursor);
}

/**
 * Return only the next cursor for focused compatibility tests.
 * @param prev - Cursor used for this request.
 * @param fresh - Rows not already covered.
 * @param served - Every row PayBox returned.
 * @returns Next cursor, or false when the walk ended.
 */
function nextWalletCursor(
  prev: IPayBoxCursor,
  fresh: readonly IWalletTxnRaw[],
  served: readonly IWalletTxnRaw[],
): IPayBoxCursor | false {
  return walletPagination.nextWalletCursor(prev, fresh, served);
}

/**
 * Remove rows an earlier page already emitted.
 * @param cursor - Cursor used for this page.
 * @param raws - Raw rows returned by PayBox.
 * @returns Rows not already covered.
 */
function dropCoveredRows(
  cursor: IPayBoxCursor,
  raws: readonly IWalletTxnRaw[],
): readonly IWalletTxnRaw[] {
  return walletPagination.dropCoveredRows(cursor, raws);
}

/**
 * Wallet endpoint is fixed — every wallet account routes through
 * /getUserHistory. Exposed as the shape's `urlTag` producer.
 * @returns Constant WK URL group.
 */
export const TXNS_URL_TAG: TxnsUrlTag<IPayBoxAcct, IPayBoxCursor> = (): WKUrlGroup =>
  'data.getUserHistory';

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
 * Raw rows the server put on this page, before dedup.
 * @param body - Response body.
 * @returns Raw wallet rows (empty when `nc` is absent / not an array).
 */
function servedRows(body: Record<string, unknown>): readonly IWalletTxnRaw[] {
  const rawNc = readContent(body).nc;
  return (Array.isArray(rawNc) ? rawNc : []) as readonly IWalletTxnRaw[];
}

/**
 * Name of the refusal an ERROR ENVELOPE carries, or `''` for a real page.
 *
 * <p>PayBox answers a refused read with HTTP 200 carrying
 * `{explanation, code, name, message}` and no `content` block. Keyed on
 * the presence of an error `name` with no `content`, so a genuinely
 * empty page (which does carry `content`) reads as `''` and stays legal.
 * @param body - Response body.
 * @returns The refusal name, or `''` when the body is a real page.
 */
function refusalNameOf(body: Record<string, unknown>): string {
  const name = body.name;
  if (body.content !== undefined || typeof name !== 'string') return '';
  return name;
}

/**
 * Pass a response body through, rejecting an ERROR ENVELOPE.
 *
 * <p>Because {@link servedRows} only looks for `content.nc`, a refusal
 * envelope (`{name, code, message}` with no `content`) would otherwise
 * read as a legitimately empty page and the run would report zero
 * transactions as a SILENT success — indistinguishable from an unused
 * wallet. This guard rejects that envelope so the failure surfaces
 * loudly instead.
 *
 * <p>Authenticated reads require HMAC signature headers (`X-Timestamp`,
 * `X-Nonce`, `X-Signature`); without them PayBox refuses with `401`
 * (`"missing signature headers"`). This is a server-side requirement,
 * not a credential fault — a valid token and `uId` still yield the `401`.
 * The getKey bootstrap seeds the signing key so signed reads succeed;
 * this guard is the backstop for any remaining refusal.
 * @param body - Response body.
 * @returns The same body when it is a real page.
 * @throws ScraperError when the body is an error envelope.
 */
function assertPageBody(body: Record<string, unknown>): Record<string, unknown> {
  const refusal = refusalNameOf(body);
  if (refusal.length > 0) {
    const why = `PayBox transactions request was refused (${refusal});`;
    throw new ScraperError(`${why} no page was returned.`);
  }
  return body;
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
  const pageBody = assertPageBody(args.body);
  const cursor = walletCursorOf(args.cursor);
  const served = servedRows(pageBody);
  const raws = dropCoveredRows(cursor, served);
  const mapped = raws.map(mapWalletTxn);
  const advance = walletPagination.walletAdvance({ prev: cursor, fresh: raws, served });
  return { items: mapped, ...advance };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_TXNS_INTERNALS = {
  nextWalletCursor,
  walletCursorOf,
  dropCoveredRows,
  buildAuthEnvelope,
  mapWalletTxn,
} as const;
