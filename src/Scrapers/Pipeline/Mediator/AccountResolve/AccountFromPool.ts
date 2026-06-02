/**
 * Account discovery from a captured network pool — pure helper.
 *
 * <p>Co-located with `Mediator/Network/` after M1+ (was
 * `Mediator/Auth/AccountDiscovery.ts`). Network owns the captured-
 * endpoint shape; this helper walks the pool with a
 * WK_ACCT-driven predicate to identify which captures carry account
 * information. ACCOUNT-RESOLVE.POST consumes the result via
 * downward dependency on the Network surface; no phase-mediator
 * imports it.
 *
 * <p>Contract:
 * <ul>
 *   <li>Input: a list of captures the auth phase saw before any
 *       dashboard navigation click (always `getPreNavCaptures()`).</li>
 *   <li>Output: `{ endpoint, ids, records, containers }`.
 *       `endpoint` is the capture picked as the account source
 *       (diagnostic only); `ids`/`records`/`containers` come from
 *       `extractAccountIds` / `extractAccountRecords` so SCRAPE.PRE
 *       consumes a stable shape regardless of which bank produced
 *       the data.</li>
 * </ul>
 *
 * <p>Why a separate helper (not a method on `INetworkDiscovery`):
 * <ul>
 *   <li>The network surface stays a black box that returns raw
 *       captures.</li>
 *   <li>Account-extraction shape predicate (WK_ACCT) is content-
 *       aware; keeping it out of the network primitive lets future
 *       phases plug in their own pool-walkers without coupling to
 *       the network surface.</li>
 * </ul>
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';
import type { ApiPayload } from '../../Strategy/Scrape/ScrapeTypes.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import {
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
  findFieldValue,
} from '../Scrape/ScrapeAutoMapper.js';

/**
 * Result of {@link discoverAccountsInPool}.
 *
 * <ul>
 *   <li>`endpoint` is `false` when no capture in the pool exposed an
 *       account container.</li>
 *   <li>`ids` and `records` are populated when the picker found a
 *       body container OR the request-side fallback fired (Hapoalim
 *       URL-query case).</li>
 *   <li>`containers` holds the per-WK-name split (Phase 7d) when the
 *       picked endpoint exposes named containers; empty otherwise
 *       (root-array fallback or request-side fallback).</li>
 * </ul>
 */
interface IAccountDiscoveryResult {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/**
 * True iff the first element of a candidate array is an object that
 * exposes an account-id field. Extracted so the surrounding guard
 * (`hasRootAccountArray`) stays under the LoC cap and the array-
 * element shape check is greppable on its own.
 *
 * @param arr - Non-empty array peeled from the response body.
 * @returns True iff `arr[0]` carries a WK account-id field.
 */
function isAccountShapedFirstElement(arr: readonly unknown[]): boolean {
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  const hit = findFieldValue(first as Record<string, unknown>, [...WK_ACCT.id]);
  return hit !== false;
}

/**
 * Returns true when the FIRST element of a root-level array exposes
 * an account-id field (one of `WK_ACCT.id`). Used as a strict
 * shape check for the Hapoalim `[{accountNumber,bankNumber,…}]`
 * pattern — DELIBERATELY ignores the loose `findFirstArray` tier so
 * a `{ transactions: [...] }` capture is NOT mistaken for an account
 * list.
 * @param ep - Captured endpoint.
 * @returns True iff body is a non-empty root array of account-shaped
 *   records.
 */
function hasRootAccountArray(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (!Array.isArray(body)) return false;
  const arr = body as readonly unknown[];
  if (arr.length === 0) return false;
  return isAccountShapedFirstElement(arr);
}

/**
 * Returns the SUM of all WK named-container record counts reachable
 * from this capture's response body. Phase 7d change: where the
 * legacy helper returned the first-match container's size, the new
 * implementation walks every WK container so payloads carrying both
 * `cards` AND `bankAccounts` (VisaCal `account/init`) score the
 * combined cardinality. Zero when the body has no named container
 * or every record fails the {@link looksLikeAccountRecord} filter.
 * Used by {@link pickAccountEndpoint} to score across the pool and
 * by {@link poolMaxContainer} to drive the fail-loud guard in
 * ACCOUNT-RESOLVE.POST.
 * @param ep - Captured endpoint.
 * @returns Total record count across all WK containers in the body,
 *   or 0.
 */
function sumContainerRecords(ep: IDiscoveredEndpoint): number {
  const body = ep.responseBody;
  if (body === null) return 0;
  if (typeof body !== 'object') return 0;
  const containers = extractAllContainers(body as ApiPayload);
  let total = 0;
  for (const name of Object.keys(containers)) total += containers[name].length;
  return total;
}

/**
 * Possible JSON leaf or branch shapes a record's own value can take.
 * Defined as a closed union so the tie-break helpers stay typed
 * without leaking `unknown` across function boundaries.
 */
type FieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

/**
 * Returns true when `value` carries information — non-empty string,
 * any number/boolean, or a non-null object/array. Drives the field-
 * richness tie-break in {@link firstRecordFieldRichness} so empty
 * strings, nulls, and undefined contribute zero to the score.
 * @param value - Field value to test.
 * @returns True iff value carries information.
 */
function isPopulated(value: FieldValue): boolean {
  if (value === null) return false;
  if (value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/**
 * Count populated own keys on a single record, casting via the
 * {@link FieldValue} alias so the populated-field tie-break stays
 * typed end-to-end.
 *
 * @param record - First container record to score.
 * @returns Number of own keys whose value satisfies {@link isPopulated}.
 */
function countPopulatedEntries(record: Record<string, unknown>): number {
  const entries = Object.entries(record) as readonly (readonly [string, FieldValue])[];
  return entries.filter((entry): boolean => isPopulated(entry[1])).length;
}

/**
 * Counts populated own keys on the FIRST record of the FIRST WK
 * container reachable from this capture's body. Used as the
 * deterministic tie-break when two candidate endpoints expose
 * containers of identical size — the richer record wins so consumers
 * see complete metadata (card name, owner, branch, etc.).
 * @param ep - Captured endpoint.
 * @returns Populated-field count of the first container record, or 0.
 */
function firstRecordFieldRichness(ep: IDiscoveredEndpoint): number {
  const body = ep.responseBody;
  if (body === null || typeof body !== 'object') return 0;
  const containers = extractAllContainers(body as ApiPayload);
  const names = Object.keys(containers);
  if (names.length === 0) return 0;
  return countPopulatedEntries(containers[names[0]][0]);
}

/** Scoring tuple used to rank pool candidates for the picker. */
interface IPoolCandidate {
  readonly endpoint: IDiscoveredEndpoint;
  readonly count: number;
  readonly richness: number;
}

/**
 * Builds a scoring tuple for one endpoint — bundles container size,
 * field richness, and the original endpoint reference so the sort
 * stays stable.
 * @param ep - Captured endpoint.
 * @returns Scoring tuple.
 */
function scoreCandidate(ep: IDiscoveredEndpoint): IPoolCandidate {
  return {
    endpoint: ep,
    count: sumContainerRecords(ep),
    richness: firstRecordFieldRichness(ep),
  };
}

/**
 * Compares two candidates for descending-cardinality sort. Primary
 * key is container size (more records win), tie-break by metadata
 * richness, final tie-break by capture order so the result is
 * deterministic across runs.
 * @param a - Left candidate.
 * @param b - Right candidate.
 * @returns Negative when a wins, positive when b wins.
 */
function compareCandidates(a: IPoolCandidate, b: IPoolCandidate): number {
  const byCount = b.count - a.count;
  if (byCount !== 0) return byCount;
  const byRichness = b.richness - a.richness;
  if (byRichness !== 0) return byRichness;
  const aIdx = a.endpoint.captureIndex ?? 0;
  const bIdx = b.endpoint.captureIndex ?? 0;
  return aIdx - bIdx;
}

/**
 * Picks the capture whose response body exposes the LARGEST WK
 * named container reachable across the entire pool. Falls back to
 * the root-array path (Hapoalim's bare `[{accountNumber,…}]`) when
 * no endpoint exposes a named container.
 *
 * <p>Why max-cardinality: multi-card banks (Amex, Isracard) fire a
 * partial-list endpoint (`GetDirectDebitList`) BEFORE the full-list
 * endpoint (`GetCardList`). The legacy first-match picker stopped
 * at the partial list and silently dropped cards. Scoring ALL
 * candidates and picking the max prevents the regression. Tie-break
 * by metadata richness keeps the response with the most complete
 * card records.
 *
 * @param pool - Pre-nav captures supplied by ACCOUNT-RESOLVE.POST.
 * @returns Endpoint with the richest container, root-array fallback, or false.
 */
function pickAccountEndpoint(pool: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const candidates = pool.map(scoreCandidate).filter((c): boolean => c.count > 0);
  if (candidates.length > 0) {
    const sorted = [...candidates].sort(compareCandidates);
    return sorted[0].endpoint;
  }
  const rootShape = pool.find(hasRootAccountArray);
  return rootShape ?? false;
}

/**
 * Picks the larger of two numbers. Pulled out to satisfy the
 * project's no-nested-call lint rule when reducing across the pool.
 * @param a - Left value.
 * @param b - Right value.
 * @returns Larger of {@link a} and {@link b}.
 */
function maxNumber(a: number, b: number): number {
  if (a >= b) return a;
  return b;
}

/**
 * Reduces one pool entry into the running maximum sum-of-containers
 * size. Extracted helper so {@link poolMaxContainer} stays linear.
 * @param max - Running maximum.
 * @param ep - Captured endpoint.
 * @returns New running maximum.
 */
function reduceMaxContainer(max: number, ep: IDiscoveredEndpoint): number {
  const sum = sumContainerRecords(ep);
  return maxNumber(max, sum);
}

/**
 * Returns the LARGEST sum-of-WK-containers seen across the pool.
 * ACCOUNT-RESOLVE.POST consumes this to enforce the fail-loud
 * incomplete guard: if the resolved id count is less than this
 * value, the phase halts the run with `ACCOUNT_RESOLUTION_INCOMPLETE`
 * so silent data loss is impossible. Phase 7d change: each pool
 * entry contributes its SUM across all WK containers in its body
 * (not the legacy first-match container size), so a payload with
 * `cards: [4]` + `bankAccounts: [3]` scores 7 instead of 4.
 * @param pool - Pre-nav captures supplied by ACCOUNT-RESOLVE.POST.
 * @returns Maximum sum-of-WK-container records across the pool, or 0.
 */
function poolMaxContainer(pool: readonly IDiscoveredEndpoint[]): number {
  let max = 0;
  for (const ep of pool) max = reduceMaxContainer(max, ep);
  return max;
}

/** Possible scalar shapes returned by `findFieldValue`. */
type IScalarFieldHit = string | number | boolean;

/**
 * Coerce a `findFieldValue` result to a non-empty string identifier.
 * @param hit - Raw field value.
 * @returns Identifier string or false.
 */
function asAccountId(hit: IScalarFieldHit): string | false {
  if (typeof hit === 'string' && hit.length > 0) return hit;
  if (typeof hit === 'number') return String(hit);
  return false;
}

/**
 * Parse a URL string into a `URL` instance, returning `false` when
 * the input is malformed. Pure helper so callers stay flat.
 *
 * @param url - Raw URL string from the capture.
 * @returns Parsed URL or `false` on syntax error.
 */
function tryParseUrl(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Materialise a `URLSearchParams` into a plain `Record<string,string>`
 * so {@link findFieldValue} (which walks plain objects) can scan the
 * query for an account-id field.
 *
 * @param params - Query parameters from a parsed URL.
 * @returns Plain record snapshot of the params.
 */
function urlSearchParamsToRecord(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of params.entries()) {
    out[name] = value;
  }
  return out;
}

/**
 * Inspect a GET capture's URL query parameters for an account-id-
 * shaped value. Pure URL-side: never reads the response body, never
 * touches `postData`. Mirrors how the request itself carries the
 * identifier (Hapoalim's `?accountId=12-170-…`, etc.).
 * @param ep - Captured endpoint (must be `method === 'GET'`).
 * @returns Identifier or false.
 */
function extractAccountIdFromGetUrl(ep: IDiscoveredEndpoint): string | false {
  const parsed = tryParseUrl(ep.url);
  if (parsed === false) return false;
  const queryRecord = urlSearchParamsToRecord(parsed.searchParams);
  const hit = findFieldValue(queryRecord, [...WK_ACCT.id]);
  return asAccountId(hit);
}

/** Discriminated result of parsing a POST capture's `postData`. */
interface IParsedPostBody {
  readonly hasObject: boolean;
  readonly body: Readonly<Record<string, unknown>>;
}

const EMPTY_PARSED_BODY: IParsedPostBody = { hasObject: false, body: {} };

/**
 * Try to parse `postData` as JSON. Returns the parsed value cast to
 * the discriminated result so the caller stays flat (one-step
 * try/catch with no inner control flow).
 * @param postData - Raw POST body string.
 * @returns Wrapped parsed body.
 */
function tryParsePostData(postData: string): IParsedPostBody {
  try {
    const raw = JSON.parse(postData) as Record<string, unknown>;
    return { hasObject: true, body: raw };
  } catch {
    return EMPTY_PARSED_BODY;
  }
}

/**
 * Parse a POST capture's `postData` as a JSON object record. Returns
 * `EMPTY_PARSED_BODY` when empty / malformed / non-object so the
 * caller stays flat.
 * @param postData - Raw POST body string.
 * @returns Wrapped parsed body.
 */
function parsePostDataObject(postData: string): IParsedPostBody {
  if (postData.length === 0) return EMPTY_PARSED_BODY;
  const parsed = tryParsePostData(postData);
  if (!parsed.hasObject) return EMPTY_PARSED_BODY;
  // `JSON.parse('null')` returns the JS `null` value — the type cast
  // in `tryParsePostData` does not narrow that at runtime, so we
  // double-check before downstream walkers (which call `Object.keys`)
  // see a non-record. `Array.isArray` covers JSON arrays.
  const body = parsed.body as unknown;
  if (body === null) return EMPTY_PARSED_BODY;
  if (typeof body !== 'object') return EMPTY_PARSED_BODY;
  if (Array.isArray(body)) return EMPTY_PARSED_BODY;
  return parsed;
}

/**
 * Inspect a POST capture's request `postData` for an account-id-
 * shaped value. Pure postData-side: never reads the response body,
 * never touches the URL query. Mirrors how a POST request carries
 * its identifier in the JSON body it sends to the server.
 * @param ep - Captured endpoint (must be `method === 'POST'`).
 * @returns Identifier or false.
 */
function extractAccountIdFromPostData(ep: IDiscoveredEndpoint): string | false {
  // Method-gating is the caller's job (see `extractAccountIdFromRequest`).
  const parsed = parsePostDataObject(ep.postData);
  if (!parsed.hasObject) return false;
  const hit = findFieldValue(parsed.body, [...WK_ACCT.id]);
  return asAccountId(hit);
}

/**
 * Strict per-method request-side extraction. GET → URL only,
 * POST → postData only. No mixing across methods. The response body
 * is the separate (response-side) concern handled by
 * `pickAccountEndpoint` above.
 * @param ep - Capture to inspect.
 * @returns Identifier surfaced from the request, or false.
 */
function extractAccountIdFromRequest(ep: IDiscoveredEndpoint): string | false {
  if (ep.method === 'GET') return extractAccountIdFromGetUrl(ep);
  if (ep.method === 'POST') return extractAccountIdFromPostData(ep);
  return false;
}

/** Pair of (capture, extracted id) — surfaced by request-side discovery. */
interface IRequestHit {
  readonly ep: IDiscoveredEndpoint;
  readonly id: string;
}

/** Empty discovery sentinel — shared so the picker stays allocation-free. */
const EMPTY_DISCOVERY: IAccountDiscoveryResult = {
  endpoint: false,
  ids: [],
  records: [],
  containers: {},
};

/**
 * Bridge a single capture to an {@link IRequestHit} — returns `false`
 * when the per-method extractor cannot surface an id. Used by
 * {@link discoverAccountFromRequest} as the .map() callback.
 *
 * @param ep - Captured endpoint to inspect.
 * @returns Hit pair or `false` when no request-side id is present.
 */
function mapEndpointToRequestHit(ep: IDiscoveredEndpoint): IRequestHit | false {
  const id = extractAccountIdFromRequest(ep);
  if (id === false) return false;
  return { ep, id };
}

/**
 * Type guard for {@link IRequestHit} — exported via filter callback to
 * narrow `(IRequestHit | false)[]` → `IRequestHit[]` without inline
 * predicates that grow the orchestrator.
 *
 * @param entry - Candidate filter element.
 * @returns True iff entry is a non-`false` hit.
 */
function isRequestHit(entry: IRequestHit | false): entry is IRequestHit {
  return entry !== false;
}

/**
 * Materialise a synthetic single-account discovery result from a
 * request-side hit so the downstream consumer sees the same shape as
 * the response-side path (`pickAccountEndpoint`).
 *
 * @param winner - First request-side hit from the pool.
 * @returns Synthetic discovery carrying just the extracted id.
 */
function buildSyntheticDiscovery(winner: IRequestHit): IAccountDiscoveryResult {
  return {
    endpoint: winner.ep,
    ids: [winner.id],
    records: [{ accountId: winner.id }],
    containers: {},
  };
}

/**
 * Walk the pool until the first capture surfaces a request-side
 * identifier. Returns a synthetic single-account result so the
 * downstream consumer (SCRAPE.PRE) sees the same `{ids, records}`
 * shape regardless of which side of the capture produced the data.
 * @param pool - Pre-nav captures.
 * @returns Synthetic account result, or false.
 */
function discoverAccountFromRequest(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const hits = pool.map(mapEndpointToRequestHit).filter(isRequestHit);
  if (hits.length === 0) return EMPTY_DISCOVERY;
  return buildSyntheticDiscovery(hits[0]);
}

/**
 * Build the response-body discovery payload — pulls ids/records and
 * containers from the picked endpoint's body. Extracted so the
 * orchestrator stays a thin two-branch dispatcher.
 *
 * @param endpoint - Picked endpoint with the richest container shape.
 * @returns Discovery carrying spread copies of ids/records + containers.
 */
function buildDiscoveryFromEndpoint(endpoint: IDiscoveredEndpoint): IAccountDiscoveryResult {
  const body = endpoint.responseBody as ApiPayload;
  const ids = extractAccountIds(body);
  const records = extractAccountRecords(body);
  const containers = extractAllContainers(body);
  return { endpoint, ids: [...ids], records: [...records], containers };
}

/**
 * Pure helper — discovers accounts from the supplied capture pool.
 * Two phases, each independent:
 * 1. Response body — named container or root-array (handled by
 *    `pickAccountEndpoint` + `extractAccountIds/Records`).
 * 2. Request data — method-strict: GET → URL, POST → postData.
 *
 * The response check runs first so banks that publish full account
 * metadata in the body (Amex/Isracard/Discount/Beinleumi) keep their
 * rich records. The request-side extraction is the fallback for
 * banks that never expose a body container (Hapoalim).
 * @param pool - Pre-nav captures from `network.getPreNavCaptures()`.
 * @returns Endpoint pick + extracted ids + records (empties on miss).
 */
function discoverAccountsInPool(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const endpoint = pickAccountEndpoint(pool);
  if (endpoint === false) return discoverAccountFromRequest(pool);
  return buildDiscoveryFromEndpoint(endpoint);
}

export type { IAccountDiscoveryResult };
export { discoverAccountsInPool, poolMaxContainer };
