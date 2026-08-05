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
  /**
   * Identities the previous page already emitted that a timestamp
   * comparison alone cannot rule out: rows sitting exactly on `ts`, and
   * rows whose own `ts` is unparseable. Absent on the first page.
   */
  readonly seenIds?: readonly string[];
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
 * Stable per-row identity, read from the canonical mapping rather than
 * the raw row. Deduplicating on the very value the caller receives as
 * `identifier` keeps the two definitions from drifting apart.
 * @param raw - Raw wallet row.
 * @returns Row identity, or `''` when the row carries none.
 */
function rowIdentity(raw: IWalletTxnRaw): string {
  const txn = mapWalletTxn(raw);
  return String(txn.identifier ?? '');
}

/**
 * Parse a raw row timestamp to epoch milliseconds.
 * @param ts - Raw row timestamp.
 * @returns Epoch ms; `NaN` when absent, non-string, or malformed.
 */
function parseTs(ts: unknown): number {
  if (typeof ts !== 'string') return Number.NaN;
  return Date.parse(ts);
}

/**
 * Decide whether a raw `ts` yields a usable boundary.
 * @param ts - Raw row timestamp.
 * @returns True when the value parses as a date.
 */
function isParsableTs(ts: unknown): boolean {
  const parsed = parseTs(ts);
  return !Number.isNaN(parsed);
}

/**
 * Oldest timestamp on the page that actually parses. Pages arrive
 * newest-first, so the last usable value is the oldest one. Advancing on
 * a malformed value would produce a cursor whose boundary is `NaN`,
 * which silently disables {@link dropCoveredRows} for the next page.
 * @param items - Raw items on the just-fetched page.
 * @returns Oldest parseable ts, or `''` when the page carries none.
 */
function lastParsableTs(items: readonly IWalletTxnRaw[]): string {
  const stamps = items.map((row): unknown => row.ts);
  const usable = stamps.filter((ts): ts is string => isParsableTs(ts));
  return usable.at(-1) ?? '';
}

/**
 * Decide whether a row's timestamp leaves its freshness undecided —
 * either it sits exactly on the boundary, or it does not parse at all.
 * @param ts - Raw row timestamp.
 * @param boundaryMs - Boundary as epoch milliseconds.
 * @returns True when only identity can settle the row.
 */
function isAmbiguousTs(ts: unknown, boundaryMs: number): boolean {
  const parsed = parseTs(ts);
  return Number.isNaN(parsed) || parsed === boundaryMs;
}

/**
 * Identities the next page cannot rule out by timestamp alone — rows on
 * the new boundary, plus rows whose `ts` does not parse (those are kept
 * fail-open, so only identity can recognise them a second time).
 *
 * Timestamps are compared as parsed instants, exactly as
 * {@link isFreshRow} compares them, so two spellings of the same instant
 * cannot disagree about which rows are ambiguous.
 * @param items - Raw items on the just-fetched page.
 * @param boundaryTs - Timestamp the next cursor will carry.
 * @returns Identities to remember; rows without one are omitted.
 */
function ambiguousIds(items: readonly IWalletTxnRaw[], boundaryTs: string): readonly string[] {
  const boundaryMs = parseTs(boundaryTs);
  const edge = items.filter((row): boolean => isAmbiguousTs(row.ts, boundaryMs));
  const ids = edge.map(rowIdentity);
  return ids.filter((id): boolean => id !== '');
}

/**
 * Compute the next ts cursor — uses the oldest parseable ts in the page
 * to advance, terminating when the page is empty, no ts parses, the
 * cursor stalls, or the page cap (24) is reached.
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
  const oldest = lastParsableTs(items);
  if (oldest === '' || oldest === prev.ts) return false;
  return { ts: oldest, page: prev.page + 1, seenIds: ambiguousIds(items, oldest) };
}

/**
 * Decide whether a raw row is one an earlier page has not emitted.
 *
 * Identity is decisive when the row carries one; the timestamp only
 * settles rows the cursor has provably moved past. A row exactly on the
 * boundary is kept when its identity proves it is a different
 * transaction that merely shares the timestamp.
 * @param raw - Raw row under test.
 * @param boundaryMs - Cursor timestamp as epoch milliseconds.
 * @param seen - Identities the previous page already emitted.
 * @returns True when the row still belongs on this page.
 */
function isFreshRow(raw: IWalletTxnRaw, boundaryMs: number, seen: ReadonlySet<string>): boolean {
  const id = rowIdentity(raw);
  if (id !== '' && seen.has(id)) return false;
  const parsed = parseTs(raw.ts);
  if (Number.isNaN(parsed)) return true;
  if (parsed !== boundaryMs) return parsed < boundaryMs;
  return id !== '';
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
 * @returns Rows not already covered; all rows on page 0.
 */
function dropCoveredRows(
  cursor: IPayBoxCursor,
  raws: readonly IWalletTxnRaw[],
): readonly IWalletTxnRaw[] {
  const boundaryMs = Date.parse(cursor.ts);
  if (cursor.page === 0 || Number.isNaN(boundaryMs)) return raws;
  const seen = new Set(cursor.seenIds ?? []);
  return raws.filter((raw): boolean => isFreshRow(raw, boundaryMs, seen));
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
  const served = servedRows(args.body);
  const raws = dropCoveredRows(cursor, served);
  const mapped = raws.map(mapWalletTxn);
  return { items: mapped, nextCursor: nextWalletCursor(cursor, raws) };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_TXNS_INTERNALS = {
  nextWalletCursor,
  walletCursorOf,
  dropCoveredRows,
  buildAuthEnvelope,
  mapWalletTxn,
} as const;
