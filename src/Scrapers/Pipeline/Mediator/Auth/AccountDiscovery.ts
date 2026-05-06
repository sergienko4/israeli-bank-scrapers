/**
 * Account discovery — owned by the auth FINAL stage (LOGIN.FINAL for
 * non-OTP banks, OTP-FILL.FINAL for OTP banks). Operates on the
 * caller-supplied pool (always `getPreNavCaptures()`), so the
 * boundary between auth-side concerns and dashboard/scrape concerns
 * stays bright.
 *
 * Contract:
 * - Input is a list of captures the auth phase saw before any
 *   dashboard navigation click.
 * - Output is `{ endpoint, ids, records }`. `endpoint` is the capture
 *   we picked as the account source (kept for diagnostic logging);
 *   `ids` and `records` are populated via `extractAccountIds` /
 *   `extractAccountRecords` so SCRAPE.PRE consumes a stable shape
 *   regardless of which bank produced the data.
 *
 * Why a separate helper (not a method on `INetworkDiscovery`):
 * - The network surface stays a black box that returns raw captures.
 *   Account-extraction is a domain concern owned by the auth phase,
 *   not by the network primitive.
 * - Reused identically by `LoginSignalProbe` (LOGIN.FINAL) and
 *   `OtpFillPhaseActions.executeFillFinal` (OTP-FILL.FINAL).
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_TXN } from '../../Registry/WK/ScrapeWK.js';
import type { ApiPayload } from '../../Strategy/Scrape/ScrapeTypes.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import {
  extractAccountIds,
  extractAccountRecords,
  findContainerArray,
  findFieldValue,
} from '../Scrape/ScrapeAutoMapper.js';

/**
 * Result of `discoverAccountsInPool`. `endpoint` is `false` when no
 * capture in the pool exposed an account container; `ids` and
 * `records` are then empty.
 */
interface IAccountDiscoveryResult {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/**
 * Returns true when the capture's response body holds a non-empty
 * `WK.accountContainers` array (`cardsList` / `cards` / `accounts` /
 * `bankAccounts`). Pure check, no extraction.
 * @param ep - Captured endpoint.
 * @returns True iff the body holds a named account container.
 */
function hasNamedContainer(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (body === null) return false;
  if (typeof body !== 'object') return false;
  const records = findContainerArray(body as ApiPayload, [...WK_TXN.accountContainers]);
  return records.length > 0;
}

/**
 * Returns true when the FIRST element of a root-level array exposes
 * an account-id field (one of `WK_TXN.accountId`). Used as a strict
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
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  const fields = [...WK_TXN.accountId];
  const hit = findFieldValue(first as Record<string, unknown>, fields);
  return hit !== false;
}

/**
 * Pick the first capture whose response body exposes account-shaped
 * records — preferring named containers (tier 1) over the root-array
 * fallback (tier 3). The 2-pass walk preserves ordering: named
 * containers always win when both exist in the same pool.
 * @param pool - Pre-nav captures supplied by the auth FINAL.
 * @returns First matching endpoint, or false.
 */
function pickAccountEndpoint(pool: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const named = pool.find(hasNamedContainer);
  if (named) return named;
  const rootShape = pool.find(hasRootAccountArray);
  return rootShape ?? false;
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
 * Inspect a GET capture's URL query parameters for an account-id-
 * shaped value. Pure URL-side: never reads the response body, never
 * touches `postData`. Mirrors how the request itself carries the
 * identifier (Hapoalim's `?accountId=12-170-…`, etc.).
 * @param ep - Captured endpoint (must be `method === 'GET'`).
 * @returns Identifier or false.
 */
function extractAccountIdFromGetUrl(ep: IDiscoveredEndpoint): string | false {
  // Method-gating is the caller's job (see `extractAccountIdFromRequest`)
  // so this helper stays single-purpose: parse URL, query, return id.
  let parsed: URL;
  try {
    parsed = new URL(ep.url);
  } catch {
    return false;
  }
  const queryRecord: Record<string, string> = {};
  for (const [name, value] of parsed.searchParams.entries()) {
    queryRecord[name] = value;
  }
  const hit = findFieldValue(queryRecord, [...WK_TXN.accountId]);
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
  const hit = findFieldValue(parsed.body, [...WK_TXN.accountId]);
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

/**
 * Walk the pool until the first capture surfaces a request-side
 * identifier. Returns a synthetic single-account result so the
 * downstream consumer (SCRAPE.PRE) sees the same `{ids, records}`
 * shape regardless of which side of the capture produced the data.
 * @param pool - Pre-nav captures.
 * @returns Synthetic account result, or false.
 */
function discoverAccountFromRequest(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const hits = pool
    .map((ep): { ep: IDiscoveredEndpoint; id: string } | false => {
      const id = extractAccountIdFromRequest(ep);
      if (id === false) return false;
      return { ep, id };
    })
    .filter((entry): entry is { ep: IDiscoveredEndpoint; id: string } => entry !== false);
  if (hits.length === 0) return { endpoint: false, ids: [], records: [] };
  const winner = hits[0];
  return {
    endpoint: winner.ep,
    ids: [winner.id],
    records: [{ accountId: winner.id }],
  };
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
  if (endpoint !== false) {
    const body = endpoint.responseBody as ApiPayload;
    const ids = extractAccountIds(body);
    const records = extractAccountRecords(body);
    return { endpoint, ids: [...ids], records: [...records] };
  }
  return discoverAccountFromRequest(pool);
}

export type { IAccountDiscoveryResult };
export { discoverAccountsInPool };
