/**
 * BaNCS auth corroboration — recognizes a captured, authenticated BaNCS
 * account-data API response by SHAPE, not by URL-well-known matching.
 *
 * <p>TCS BaNCS multiplexes every data resource through
 * `POST …/BaNCSDigitalApp/account`, so the shared `PIPELINE_WELL_KNOWN_API`
 * URL patterns (`account/init`, `userAccountsData`, …) never match it — the
 * same blind spot Gap L closed for the txn header replay. AUTH-DISCOVERY
 * needs this signal to corroborate a login when the timing-sensitive
 * visible-text REVEAL probe misses on a slow Angular post-login redirect
 * (`#/main/home`).
 *
 * <p>Fail-closed / default-deny: a capture qualifies ONLY when it is a
 * JSON response whose body carries the BaNCS `Payload.DataEntity[]`
 * envelope. The Imperva/BaNCS `לא ניתן להשלים בקשה` interstitial (HTML,
 * served 200) fails the JSON + envelope guard, so it can NEVER corroborate
 * — an unauthenticated / error page does not produce the authed data
 * envelope. Every non-BaNCS capture also fails the guard, so the other
 * pipeline banks (Leumi/Discount/VisaCal/Max/Isracard) are unaffected.
 * The caller pairs this with the generic 2xx status check.
 *
 * <p>PII-safe: pure structural predicate — reads only the envelope shape,
 * never a field value; no log sink. A pure leaf keyed by shape, mirroring
 * {@link "./BancsTxnRequest.js"} — no Network/AuthDiscovery import.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn } from './BancsShape.js';

/** BaNCS resource URL — every data resource is multiplexed through it. */
const BANCS_ACCOUNT_URL = /BaNCSDigitalApp\/account/i;

/** Minimal capture surface the auth guard reads — url + response shape. */
interface IBancsAuthCapture {
  readonly url: string;
  readonly contentType: string;
  readonly responseBody: unknown;
}

/**
 * Whether a captured content type denotes JSON — excludes the HTML
 * Imperva/BaNCS interstitial served with a 200 status.
 * @param contentType - Response content-type header value.
 * @returns True when the type denotes JSON.
 */
function isJsonType(contentType: string): boolean {
  return contentType.toLowerCase().includes('json');
}

/**
 * Whether a parsed body carries the BaNCS `Payload.DataEntity[]` envelope
 * every authed BaNCS data response emits (account / balance / portfolio).
 * @param body - Parsed response body (any JSON value).
 * @returns True when the BaNCS data envelope is present.
 */
function hasBancsEnvelope(body: unknown): boolean {
  const entities = getIn(body as ApiRecord, ['Payload', 'DataEntity']);
  return Array.isArray(entities);
}

/**
 * Recognize an authenticated BaNCS account-data response by shape.
 * @param cap - Captured endpoint surface (url + content type + body).
 * @returns True when the capture is a JSON BaNCS `/account` envelope.
 */
function isBancsAuthResponse(cap: IBancsAuthCapture): boolean {
  if (!BANCS_ACCOUNT_URL.test(cap.url)) return false;
  if (!isJsonType(cap.contentType)) return false;
  return hasBancsEnvelope(cap.responseBody);
}

export type { IBancsAuthCapture };
export { BANCS_ACCOUNT_URL, isBancsAuthResponse };
