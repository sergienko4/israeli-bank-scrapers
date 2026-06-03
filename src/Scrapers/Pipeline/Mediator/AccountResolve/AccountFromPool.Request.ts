/**
 * AccountFromPool.Request — request-side discovery fallback. Extracted
 * from the AccountFromPool barrel so the per-file LoC cap is honoured
 * (phase-2e-residue). GET → URL only, POST → postData only.
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { findFieldValue } from '../Scrape/ScrapeAutoMapper.js';
import type { IAccountDiscoveryResult } from './AccountFromPool.Types.js';
import { EMPTY_DISCOVERY } from './AccountFromPool.Types.js';

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
 * Parse a URL string into a `URL` instance, returning `false` when malformed.
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
 * Materialise a `URLSearchParams` into a plain `Record<string,string>`.
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
 * Inspect a GET capture's URL query parameters for an account-id-shaped value.
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
 * Try to parse `postData` as JSON.
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
 * Parse a POST capture's `postData` as a JSON object record.
 * @param postData - Raw POST body string.
 * @returns Wrapped parsed body.
 */
function parsePostDataObject(postData: string): IParsedPostBody {
  if (postData.length === 0) return EMPTY_PARSED_BODY;
  const parsed = tryParsePostData(postData);
  if (!parsed.hasObject) return EMPTY_PARSED_BODY;
  const body = parsed.body as unknown;
  if (body === null) return EMPTY_PARSED_BODY;
  if (typeof body !== 'object') return EMPTY_PARSED_BODY;
  if (Array.isArray(body)) return EMPTY_PARSED_BODY;
  return parsed;
}

/**
 * Inspect a POST capture's request `postData` for an account-id-shaped value.
 * @param ep - Captured endpoint (must be `method === 'POST'`).
 * @returns Identifier or false.
 */
function extractAccountIdFromPostData(ep: IDiscoveredEndpoint): string | false {
  const parsed = parsePostDataObject(ep.postData);
  if (!parsed.hasObject) return false;
  const hit = findFieldValue(parsed.body, [...WK_ACCT.id]);
  return asAccountId(hit);
}

/**
 * Strict per-method request-side extraction.
 * GET → URL only, POST → postData only.
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

/**
 * Bridge a single capture to an {@link IRequestHit}.
 * @param ep - Captured endpoint to inspect.
 * @returns Hit pair or `false` when no request-side id is present.
 */
function mapEndpointToRequestHit(ep: IDiscoveredEndpoint): IRequestHit | false {
  const id = extractAccountIdFromRequest(ep);
  if (id === false) return false;
  return { ep, id };
}

/**
 * Type guard for {@link IRequestHit}.
 * @param entry - Candidate filter element.
 * @returns True iff entry is a non-`false` hit.
 */
function isRequestHit(entry: IRequestHit | false): entry is IRequestHit {
  return entry !== false;
}

/**
 * Materialise a synthetic single-account discovery result from a request hit.
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
 * Walk the pool until the first capture surfaces a request-side identifier.
 * @param pool - Pre-nav captures.
 * @returns Synthetic account result, or EMPTY_DISCOVERY.
 */
function discoverAccountFromRequest(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const hits = pool.map(mapEndpointToRequestHit).filter(isRequestHit);
  if (hits.length === 0) return EMPTY_DISCOVERY;
  return buildSyntheticDiscovery(hits[0]);
}

export type { IRequestHit };
export { discoverAccountFromRequest };
