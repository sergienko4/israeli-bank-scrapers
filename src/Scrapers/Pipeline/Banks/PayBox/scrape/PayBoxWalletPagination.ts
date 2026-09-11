import type { PaginationTermination } from '../../../Strategy/Fetch/Pagination.js';
import type { IWalletTxnRaw } from './PayBoxShapeMap.js';
import { mapWalletTxn } from './PayBoxShapeMap.js';

/** Wallet pagination safety cap, aligned with PayBox's observed ~24-page limit. */
const WALLET_PAGE_CAP = 24;
/** First-page marker required by the PayBox wallet endpoint. */
const WALLET_TS_FIRST = 'null';

/** Wallet ts cursor — opaque cursor string + zero-based page index. */
interface IWalletCursor {
  readonly ts: string;
  readonly page: number;
  /** Identities at the boundary that the next page may re-serve. */
  readonly seenIds?: readonly string[];
}

/**
 * Resolve the active cursor, including PayBox's string first-page marker.
 * @param cursor - Incoming cursor, or false on the first call.
 * @returns Concrete wallet cursor.
 */
function walletCursorOf(cursor: IWalletCursor | false): IWalletCursor {
  if (cursor !== false) return cursor;
  return { ts: WALLET_TS_FIRST, page: 0 };
}

/**
 * Order record keys recursively while preserving array order.
 * @param value - Parsed JSON value.
 * @returns Equivalent value with stable record-key order.
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
 * Build a stable synthetic identity for a row with no provider id.
 * @param raw - Raw wallet row.
 * @returns Stable content fingerprint.
 */
function rowFingerprint(raw: IWalletTxnRaw): string {
  const ordered = keyOrdered(raw);
  return JSON.stringify(ordered);
}

/**
 * Read the identity used by the canonical transaction.
 * @param raw - Raw wallet row.
 * @returns Provider identity or a stable content fingerprint.
 */
function rowIdentity(raw: IWalletTxnRaw): string {
  const txn = mapWalletTxn(raw);
  const id = String(txn.identifier ?? '');
  return id === '' ? rowFingerprint(raw) : id;
}

/**
 * Keep the earlier of two parseable timestamp strings.
 * @param acc - Earliest timestamp held so far.
 * @param ts - Candidate timestamp.
 * @returns Earlier timestamp.
 */
function olderTs(acc: string, ts: string): string {
  if (acc === '') return ts;
  return parseTs(ts) < parseTs(acc) ? ts : acc;
}

/** Shape PayBox uses for a timestamp cursor. */
const ISO_TS = /^\d{4}-\d{2}-\d{2}T/u;

/**
 * Parse a PayBox timestamp.
 * @param ts - Candidate timestamp value.
 * @returns Epoch milliseconds, or NaN for an unsafe cursor value.
 */
function parseTs(ts: unknown): number {
  if (typeof ts !== 'string' || !ISO_TS.test(ts)) return Number.NaN;
  return Date.parse(ts);
}

/**
 * Decide whether a value can safely become a wallet cursor boundary.
 * @param ts - Candidate timestamp value.
 * @returns True when the timestamp is parseable.
 */
function isParsableTs(ts: unknown): boolean {
  const parsed = parseTs(ts);
  return !Number.isNaN(parsed);
}

/**
 * Find the oldest parseable timestamp on a page.
 * @param items - Raw rows on the page.
 * @returns Oldest timestamp, or an empty string when none is safe.
 */
function lastParsableTs(items: readonly IWalletTxnRaw[]): string {
  const stamps = items.map((row): unknown => row.ts);
  const usable = stamps.filter((ts): ts is string => isParsableTs(ts));
  return usable.reduce((acc, ts): string => olderTs(acc, ts), '');
}

/**
 * Decide whether only identity can classify a boundary timestamp.
 * @param ts - Row timestamp.
 * @param boundaryMs - Cursor boundary in epoch milliseconds.
 * @returns True when timestamp ordering cannot settle freshness.
 */
function isAmbiguousTs(ts: unknown, boundaryMs: number): boolean {
  const parsed = parseTs(ts);
  return Number.isNaN(parsed) || parsed === boundaryMs;
}

/**
 * Collect identities a timestamp comparison cannot rule out on the next page.
 * @param served - Every row PayBox returned.
 * @param boundaryTs - Timestamp the next cursor will carry.
 * @returns Identities to remember at the boundary.
 */
function ambiguousIds(served: readonly IWalletTxnRaw[], boundaryTs: string): readonly string[] {
  const boundaryMs = parseTs(boundaryTs);
  const edge = served.filter((row): boolean => isAmbiguousTs(row.ts, boundaryMs));
  return edge.map(rowIdentity);
}

/** Cursor and evidence produced from one wallet page. */
interface IWalletAdvance {
  readonly nextCursor: IWalletCursor | false;
  readonly termination?: PaginationTermination;
}

/**
 * End a wallet walk with explicit evidence.
 * @param termination - Reason no next cursor is offered.
 * @returns Terminal wallet advance.
 */
function walletStop(termination: PaginationTermination): IWalletAdvance {
  return { nextCursor: false, termination };
}

/**
 * Compute the next wallet cursor together with local-stop evidence.
 * @param args - Previous cursor, fresh rows, and all served rows.
 * @param args.prev - Cursor used for this request.
 * @param args.fresh - Rows not already covered by the cursor.
 * @param args.served - Every row PayBox returned.
 * @returns Cursor advance or an explicit terminal reason.
 */
function walletAdvance(args: {
  readonly prev: IWalletCursor;
  readonly fresh: readonly IWalletTxnRaw[];
  readonly served: readonly IWalletTxnRaw[];
}): IWalletAdvance {
  if (args.fresh.length === 0) {
    return walletStop(args.served.length === 0 ? 'exhausted' : 'cursorRepeat');
  }
  if (args.prev.page + 1 >= WALLET_PAGE_CAP) return walletStop('pageCeiling');
  const oldest = lastParsableTs(args.fresh);
  if (oldest === '' || oldest === args.prev.ts) return walletStop('cursorRepeat');
  const seenIds = ambiguousIds(args.served, oldest);
  return { nextCursor: { ts: oldest, page: args.prev.page + 1, seenIds } };
}

/**
 * Return only the next cursor for focused compatibility tests.
 * @param prev - Cursor used for this request.
 * @param fresh - Rows not already covered.
 * @param served - Every row PayBox returned.
 * @returns Next cursor, or false when the walk ended.
 */
function nextWalletCursor(
  prev: IWalletCursor,
  fresh: readonly IWalletTxnRaw[],
  served: readonly IWalletTxnRaw[],
): IWalletCursor | false {
  return walletAdvance({ prev, fresh, served }).nextCursor;
}

/**
 * Decide whether an earlier page is not known to have emitted a row.
 * @param raw - Candidate raw row.
 * @param boundaryMs - Cursor boundary in epoch milliseconds.
 * @param seen - Identities already emitted at the boundary.
 * @returns True when the row is fresh.
 */
function isFreshRow(raw: IWalletTxnRaw, boundaryMs: number, seen: ReadonlySet<string>): boolean {
  const identity = rowIdentity(raw);
  if (seen.has(identity)) return false;
  const parsed = parseTs(raw.ts);
  return Number.isNaN(parsed) || parsed <= boundaryMs;
}

/**
 * Drop rows an earlier page already emitted.
 * @param cursor - Cursor used for this page.
 * @param raws - Raw rows returned by PayBox.
 * @returns Rows not already covered; all rows on page zero.
 */
function dropCoveredRows(
  cursor: IWalletCursor,
  raws: readonly IWalletTxnRaw[],
): readonly IWalletTxnRaw[] {
  const boundaryMs = Date.parse(cursor.ts);
  if (cursor.page === 0 || Number.isNaN(boundaryMs)) return raws;
  const seen = new Set(cursor.seenIds ?? []);
  return raws.filter((raw): boolean => isFreshRow(raw, boundaryMs, seen));
}

export default Object.freeze({
  dropCoveredRows,
  nextWalletCursor,
  walletAdvance,
  walletCursorOf,
});
