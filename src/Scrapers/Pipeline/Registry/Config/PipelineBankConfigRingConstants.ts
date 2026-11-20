/**
 * Ring constants — the only values that differ between the card issuers
 * served by the "ring" mobile gateway. One login config factory and one
 * scrape Shape factory read them, so a ring issuer is a constants entry,
 * not new code.
 */

/** Per-issuer values for the ring mobile gateway. */
interface IRingConstants {
  /** Gateway origin, no trailing slash. */
  readonly base: string;
  /** `applicationId` query value on every `service` call. */
  readonly applicationId: string;
  /** `isrdomain` header value on every call. */
  readonly isrdomain: string;
  /** Issuer company code sent in login and transactions bodies. */
  readonly companyCode: string;
  /** Wallet id the session-token step sends; the card list keeps `216`. */
  readonly sessionWalletId: string;
  /** Registrable domain whose cookies the warm session keeps. */
  readonly cookieDomain: string;
}

/** Isracard on the ring gateway. */
const ISRACARD_RING: IRingConstants = {
  base: 'https://ring.isracard.co.il',
  applicationId: 'mi',
  isrdomain: 'isracard',
  companyCode: '11',
  sessionWalletId: '216',
  cookieDomain: 'isracard.co.il',
};

/** Amex on the ring gateway. */
const AMEX_RING: IRingConstants = {
  base: 'https://ring.americanexpress.co.il',
  applicationId: 'ma',
  isrdomain: 'amex',
  companyCode: '77',
  sessionWalletId: 'AQ',
  cookieDomain: 'americanexpress.co.il',
};

/** The wallet id the card-list call sends for every issuer. */
const RING_WALLET_ID = '216';

/** User agent of the issuers' Android app web view. */
const RING_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; Pixel 3 Build/RQ1A.210105.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Mobile Safari/537.36';

/**
 * Framing headers the edge admits before the app's own headers.
 * @param ring - Issuer constants.
 * @returns Host, encoding and connection headers.
 */
function ringFrameHeaders(ring: IRingConstants): Readonly<Record<string, string>> {
  const host = new URL(ring.base).host;
  return { Host: host, 'Accept-Encoding': 'identity', Connection: 'keep-alive' };
}

/**
 * App headers that precede the issuer domain in the app's request order.
 */
const RING_APP_HEADERS_BEFORE_DOMAIN = {
  Accept: 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
} as const;

/**
 * App headers that follow the issuer domain. `X-CLIENT-IP` carries the
 * app's external-IP value; `0.0.0.0` is its documented lookup fallback.
 */
const RING_APP_HEADERS_AFTER_DOMAIN = {
  'Accept-Language': 'en',
  platform: 'mobile',
  'User-Agent': RING_USER_AGENT,
  'X-CLIENT-IP': '0.0.0.0',
} as const;

/**
 * Compose the app headers around the issuer's domain value.
 * @param ring - Issuer constants.
 * @returns App headers in the order the app emits them.
 */
function ringAppHeaders(ring: IRingConstants): Readonly<Record<string, string>> {
  const domain = { isrdomain: ring.isrdomain };
  return { ...RING_APP_HEADERS_BEFORE_DOMAIN, ...domain, ...RING_APP_HEADERS_AFTER_DOMAIN };
}

/**
 * Headers the app sends on every ring call, login and data alike. The
 * per-call `BCKey` and `TraceIdentifier` are added by the caller.
 *
 * <p>The edge admits the app's exact order: `Host`, `Accept-Encoding` and
 * `Connection` frame the request before the app headers. Node adds its own
 * framing headers after the caller's, which the edge challenges, so these
 * are placed first here. `User-Agent` is capitalized deliberately; the
 * app's header name is part of what the edge matches. `identity` keeps the
 * node:https response plain, so the transport needs no decompressor.
 * @param ring - Issuer constants.
 * @returns Header map.
 */
function ringStaticHeaders(ring: IRingConstants): Readonly<Record<string, string>> {
  return { ...ringFrameHeaders(ring), ...ringAppHeaders(ring) };
}

export type { IRingConstants };
export { AMEX_RING, ISRACARD_RING, RING_WALLET_ID, ringStaticHeaders };
