/**
 * Stateful HAR replay rewriter — picks the right HAR entry for an
 * incoming request based on (method, canonical URL, sequence count).
 *
 * Why "stateful":
 * In SPA-style banking flows the same URL is hit multiple times
 * during the session (e.g. `/api/session` on init AND after login),
 * and HAR records the responses chronologically. A naive first-match
 * rewriter would always serve response #0, breaking the login flow.
 * This rewriter advances a per-key counter so call #N gets entry #N.
 *
 * URL canonicalization:
 * Defaults to "method + scheme://host/path" (strips query + fragment),
 * which is the most forgiving for stateful sequencing. Callers can
 * override via `urlCanonicalizer` when query params carry meaningful
 * identity (e.g. `?accountId=...`).
 *
 * Public surface (factory):
 * - {@link createStatefulRewriter} — returns {@link IStatefulRewriter}.
 *
 * Returned handle:
 * - `pick(request)` — Option-wrapped entry (None if no match / out of
 *   sequence).
 * - `snapshot()` — current per-key counts (for test assertions).
 *
 * @see ./HarTypes.ts — entry shape.
 * @see ./HarLoader.ts — produces the entries[] consumed here.
 */

import { isSome, none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import type { IHarEntry } from './HarTypes.js';

/** Request descriptor used for matching. */
interface IRewriterRequest {
  readonly method: string;
  readonly url: string;
}

/** A canonicalizer maps a raw URL to its identity key. */
type UrlCanonicalizer = (url: string) => string;

/** Spec for {@link createStatefulRewriter}. */
interface IRewriterSpec {
  readonly entries: readonly IHarEntry[];
  readonly urlCanonicalizer?: UrlCanonicalizer;
}

/** Frozen snapshot of internal counters (for test assertions). */
interface IRewriterSnapshot {
  readonly hits: ReadonlyMap<string, number>;
  readonly missCount: number;
  readonly exhaustedCount: number;
}

/** Public handle returned by {@link createStatefulRewriter}. */
interface IStatefulRewriter {
  pick(request: IRewriterRequest): Option<IHarEntry>;
  snapshot(): IRewriterSnapshot;
}

/** Internal mutable state — held in factory closure. */
interface IRewriterState {
  readonly entryIndex: ReadonlyMap<string, readonly IHarEntry[]>;
  readonly hits: Map<string, number>;
  missCount: number;
  exhaustedCount: number;
}

/**
 * Default canonicalizer: `METHOD scheme://host/pathname` (no search/hash).
 *
 * Falls back to the raw URL when {@link URL} cannot parse it (e.g.
 * Playwright `data:`/`blob:` schemes), keeping the rewriter robust.
 *
 * @param url - Raw URL from HAR or request.
 * @returns Canonical key (without query/fragment).
 */
function defaultUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Build a `method canonicalUrl` composite key.
 *
 * @param method - HTTP method (case-insensitive — upper-cased here).
 * @param canonicalUrl - Result of the URL canonicalizer.
 * @returns Composite key for the entry index.
 */
function compositeKey(method: string, canonicalUrl: string): string {
  return `${method.toUpperCase()} ${canonicalUrl}`;
}

/**
 * Append `entry` to the existing bucket for `key` (or create a fresh
 * bucket) and return the resulting list, leaving `index` updated.
 *
 * @param index - Mutable index map.
 * @param key - Composite key.
 * @param entry - HAR entry to append.
 * @returns The bucket post-append (length ≥ 1).
 */
function appendToBucket(
  index: Map<string, IHarEntry[]>,
  key: string,
  entry: IHarEntry,
): readonly IHarEntry[] {
  const bucket = index.get(key) ?? [];
  bucket.push(entry);
  index.set(key, bucket);
  return bucket;
}

/** Args bundle for {@link buildEntryIndex}. */
interface IBuildIndexArgs {
  readonly entries: readonly IHarEntry[];
  readonly canonicalize: UrlCanonicalizer;
}

/**
 * Index entries by composite key, preserving chronological order
 * within each bucket.
 *
 * @param args - Source HAR entries + URL canonicalizer.
 * @returns Frozen Map of key → entries[].
 */
function buildEntryIndex(args: IBuildIndexArgs): ReadonlyMap<string, readonly IHarEntry[]> {
  const index = new Map<string, IHarEntry[]>();
  for (const entry of args.entries) {
    const canonical = args.canonicalize(entry.request.url);
    const key = compositeKey(entry.request.method, canonical);
    appendToBucket(index, key, entry);
  }
  return index;
}

/**
 * Increment the per-key hit counter and return the resulting count.
 *
 * @param state - Mutable rewriter state.
 * @param key - Composite key.
 * @returns New hit count (1-based on first hit).
 */
function bumpHit(state: IRewriterState, key: string): number {
  const next = (state.hits.get(key) ?? 0) + 1;
  state.hits.set(key, next);
  return next;
}

/**
 * Spec for {@link selectFromBucket}.
 */
interface ISelectBucketArgs {
  readonly state: IRewriterState;
  readonly bucket: readonly IHarEntry[];
  readonly hitNumber: number;
}

/**
 * Pick the entry for the Nth hit of a bucket, or None if exhausted.
 *
 * @param args - State + bucket + 1-based hit number.
 * @returns Some(entry) when in-range; None when exhausted.
 */
function selectFromBucket(args: ISelectBucketArgs): Option<IHarEntry> {
  const zeroIndex = args.hitNumber - 1;
  if (zeroIndex >= args.bucket.length) {
    args.state.exhaustedCount = args.state.exhaustedCount + 1;
    return none();
  }
  return some(args.bucket[zeroIndex]);
}

/**
 * Spec for {@link resolveRequest}.
 */
interface IResolveArgs {
  readonly state: IRewriterState;
  readonly canonicalize: UrlCanonicalizer;
  readonly request: IRewriterRequest;
}

/**
 * Record a miss for `key` and return None.
 *
 * @param state - Mutable rewriter state.
 * @returns Always None.
 */
function recordMiss(state: IRewriterState): Option<IHarEntry> {
  state.missCount = state.missCount + 1;
  return none();
}

/**
 * Pick the next entry for `request`. Updates internal counters.
 *
 * @param args - Mutable state + canonicalizer + request descriptor.
 * @returns Some(entry) on match; None on miss/exhausted.
 */
function resolveRequest(args: IResolveArgs): Option<IHarEntry> {
  const canonical = args.canonicalize(args.request.url);
  const key = compositeKey(args.request.method, canonical);
  const bucket = args.state.entryIndex.get(key);
  if (!bucket) return recordMiss(args.state);
  const hitNumber = bumpHit(args.state, key);
  return selectFromBucket({ state: args.state, bucket, hitNumber });
}

/**
 * Freeze the mutable counters into an immutable snapshot.
 *
 * @param state - Internal state.
 * @returns Snapshot suitable for test assertions.
 */
function snapshotState(state: IRewriterState): IRewriterSnapshot {
  const hits = new Map(state.hits);
  return { hits, missCount: state.missCount, exhaustedCount: state.exhaustedCount };
}

/**
 * Build the initial mutable state for the rewriter.
 *
 * @param spec - Rewriter spec.
 * @param canonicalize - URL canonicalizer.
 * @returns Fresh mutable state.
 */
function buildInitialState(spec: IRewriterSpec, canonicalize: UrlCanonicalizer): IRewriterState {
  return {
    entryIndex: buildEntryIndex({ entries: spec.entries, canonicalize }),
    hits: new Map(),
    missCount: 0,
    exhaustedCount: 0,
  };
}

/**
 * Build the `pick` closure bound to `state` + `canonicalize`.
 *
 * @param state - Mutable rewriter state.
 * @param canonicalize - URL canonicalizer.
 * @returns Picker fn that consumes one request per call.
 */
function createPickFn(
  state: IRewriterState,
  canonicalize: UrlCanonicalizer,
): IStatefulRewriter['pick'] {
  return request => resolveRequest({ state, canonicalize, request });
}

/**
 * Build the `snapshot` closure bound to `state`.
 *
 * @param state - Mutable rewriter state.
 * @returns Zero-arg snapshot function.
 */
function createSnapshotFn(state: IRewriterState): IStatefulRewriter['snapshot'] {
  return () => snapshotState(state);
}

/**
 * Create a sequence-aware HAR replay rewriter.
 *
 * @param spec - Entries + optional URL canonicalizer.
 * @returns Handle exposing `pick` + `snapshot`.
 */
function createStatefulRewriter(spec: IRewriterSpec): IStatefulRewriter {
  const canonicalize = spec.urlCanonicalizer ?? defaultUrlKey;
  const state = buildInitialState(spec, canonicalize);
  return { pick: createPickFn(state, canonicalize), snapshot: createSnapshotFn(state) };
}

export { createStatefulRewriter, defaultUrlKey, isSome };
export type {
  IRewriterRequest,
  IRewriterSnapshot,
  IRewriterSpec,
  IStatefulRewriter,
  UrlCanonicalizer,
};
