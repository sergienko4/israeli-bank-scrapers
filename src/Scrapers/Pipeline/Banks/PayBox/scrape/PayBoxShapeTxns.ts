/**
 * PayBox scrape shape — wallet transactions helper. Wallet routes through
 * `/getUserHistory` (ts-cursor paginated, `{nc: [...]}`). Each raw row is
 * canonical-shaped by `mapWalletTxn` (split into PayBoxShapeMap.ts) so
 * the downstream `autoMapTransaction` keeps them. Pagination terminates
 * on empty page, on cursor stall, or at the server-imposed 24-page cap.
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
 * Order every record key in a parsed JSON value, leaving arrays in
 * place. Arrays are sequence data, so their order is meaning, not
 * spelling — only key order is noise.
 * @param value - Parsed JSON value.
 * @returns Structurally identical value with all record keys ordered.
 */
function keyOrdered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrdered);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  entries.sort(([a], [b]): number => a.localeCompare(b));
  const ordered = entries.map(([key, val]): [string, unknown] => [key, keyOrdered(val)]);
  return Object.fromEntries(ordered);
}

/**
 * Content fingerprint for a row PayBox gave no id. Key order is
 * normalised at every depth so a re-serve that reorders fields — nested
 * ones included — still fingerprints identically, while a genuinely
 * different transaction does not.
 * @param raw - Raw wallet row.
 * @returns Stable synthetic identity.
 */
function rowFingerprint(raw: IWalletTxnRaw): string {
  const ordered = keyOrdered(raw);
  return JSON.stringify(ordered);
}

/**
 * Stable per-row identity, read from the canonical mapping rather than
 * the raw row. Deduplicating on the very value the caller receives as
 * `identifier` keeps the two definitions from drifting apart.
 *
 * Rows PayBox gave no id fall back to a content fingerprint, so every
 * row has an identity. Without one the filter would have to choose
 * between dropping a genuine transaction and letting a re-serve through.
 * @param raw - Raw wallet row.
 * @returns Row identity; never empty.
 */
function rowIdentity(raw: IWalletTxnRaw): string {
  const txn = mapWalletTxn(raw);
  const id = String(txn.identifier ?? '');
  return id === '' ? rowFingerprint(raw) : id;
}

/**
 * Keep whichever of two parseable stamps names the earlier instant.
 * @param acc - Best stamp so far, or `''` before the first.
 * @param ts - Candidate stamp.
 * @returns The older of the two.
 */
function olderTs(acc: string, ts: string): string {
  if (acc === '') return ts;
  return parseTs(ts) < parseTs(acc) ? ts : acc;
}

/**
 * Shape PayBox stamps a row with: an ISO-8601 date followed by a time.
 * `Date.parse` alone is far too permissive for a cursor boundary — it
 * reads `'1'` as the year 2001, which would place every genuine row in
 * the future of the boundary and silently discard the next page.
 */
const ISO_TS = /^\d{4}-\d{2}-\d{2}T/u;

/**
 * Parse a raw row timestamp to epoch milliseconds.
 * @param ts - Raw row timestamp.
 * @returns Epoch ms; `NaN` when absent, non-string, or not ISO-8601.
 */
function parseTs(ts: unknown): number {
  if (typeof ts !== 'string' || !ISO_TS.test(ts)) return Number.NaN;
  return Date.parse(ts);
}

/**
 * Decide whether a raw `ts` yields a usable boundary.
 * @param ts - Raw row timestamp.
 * @returns True when the value parses as an ISO-8601 date.
 */
function isParsableTs(ts: unknown): boolean {
  const parsed = parseTs(ts);
  return !Number.isNaN(parsed);
}

/**
 * Oldest timestamp on the page that actually parses.
 *
 * Chosen by instant rather than by position: nothing in the payload
 * promises the rows are sorted, and reading the last one would leave the
 * boundary too new, so a re-serve would replay every row below it.
 * Advancing on a malformed value is refused outright — the boundary
 * would be `NaN`, which silently disables {@link dropCoveredRows}.
 * @param items - Rows to draw the boundary from.
 * @returns Oldest parseable ts, or `''` when the page carries none.
 */
function lastParsableTs(items: readonly IWalletTxnRaw[]): string {
  const stamps = items.map((row): unknown => row.ts);
  const usable = stamps.filter((ts): ts is string => isParsableTs(ts));
  const oldest = usable.reduce((acc, ts): string => olderTs(acc, ts), '');
  return oldest;
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
 * Reads the rows the server SERVED, not the ones that survived the
 * filter: a row already dropped by identity is exactly the one a further
 * re-serve will offer again, and forgetting it re-opens the fail-open
 * rule it was caught by.
 *
 * Timestamps are compared as parsed instants, exactly as
 * {@link isFreshRow} compares them, so two spellings of the same instant
 * cannot disagree about which rows are ambiguous.
 * @param served - Every raw item the server put on the page.
 * @param boundaryTs - Timestamp the next cursor will carry.
 * @returns Identities to remember; rows without one are omitted.
 */
function ambiguousIds(served: readonly IWalletTxnRaw[], boundaryTs: string): readonly string[] {
  const boundaryMs = parseTs(boundaryTs);
  const edge = served.filter((row): boolean => isAmbiguousTs(row.ts, boundaryMs));
  return edge.map(rowIdentity);
}

/**
 * Compute the next ts cursor — uses the oldest parseable ts among the
 * rows this page actually emitted to advance, terminating when nothing
 * survived, no ts parses, the cursor stalls, or the page cap (24) is
 * reached.
 * @param prev - Previous wallet cursor.
 * @param fresh - Rows that survived {@link dropCoveredRows}.
 * @param served - Every raw item the server put on the page.
 * @returns Next cursor or `false` when pagination should stop.
 */
function nextWalletCursor(
  prev: IPayBoxCursor,
  fresh: readonly IWalletTxnRaw[],
  served: readonly IWalletTxnRaw[],
): IPayBoxCursor | false {
  if (fresh.length === 0) return false;
  if (prev.page + 1 >= WALLET_PAGE_CAP) return false;
  const oldest = lastParsableTs(fresh);
  if (oldest === '' || oldest === prev.ts) return false;
  return { ts: oldest, page: prev.page + 1, seenIds: ambiguousIds(served, oldest) };
}

/**
 * Decide whether a raw row is one an earlier page has not emitted.
 *
 * Identity is decisive, and every row has one (see {@link rowIdentity}),
 * so a re-serve is always recognisable. The timestamp only settles rows
 * the cursor has provably moved past; a row on the boundary that
 * identity did not recognise is a different transaction that merely
 * shares the instant, and is kept.
 * @param raw - Raw row under test.
 * @param boundaryMs - Cursor timestamp as epoch milliseconds.
 * @param seen - Identities the previous page already emitted.
 * @returns True when the row still belongs on this page.
 */
function isFreshRow(raw: IWalletTxnRaw, boundaryMs: number, seen: ReadonlySet<string>): boolean {
  const identity = rowIdentity(raw);
  if (seen.has(identity)) return false;
  const parsed = parseTs(raw.ts);
  if (Number.isNaN(parsed)) return true;
  return parsed <= boundaryMs;
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
  return { items: mapped, nextCursor: nextWalletCursor(cursor, raws, served) };
}

/** Internals exposed for unit-test reach. */
export const PAYBOX_TXNS_INTERNALS = {
  nextWalletCursor,
  walletCursorOf,
  dropCoveredRows,
  buildAuthEnvelope,
  mapWalletTxn,
} as const;
