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
}

/** Isracard on the ring gateway. */
const ISRACARD_RING: IRingConstants = {
  base: 'https://ring.isracard.co.il',
  applicationId: 'mi',
  isrdomain: 'isracard',
  companyCode: '11',
};

/** Amex on the ring gateway. */
const AMEX_RING: IRingConstants = {
  base: 'https://ring.americanexpress.co.il',
  applicationId: 'ma',
  isrdomain: 'amex',
  companyCode: '77',
};

/** The app's wallet id, sent by the session-token login and the card list alike. */
const RING_WALLET_ID = '216';

/** User agent of the issuers' Android app web view. */
const RING_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; Pixel 3 Build/RQ1A.210105.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Mobile Safari/537.36';

/**
 * Headers the app sends on every ring call, login and data alike. The
 * per-call `bckey` and `traceidentifier` are added by the caller. Names are
 * lowercase so they replace, rather than sit beside, the transport's default
 * `content-type`.
 * @param ring - Issuer constants.
 * @returns Header map.
 */
function ringStaticHeaders(ring: IRingConstants): Readonly<Record<string, string>> {
  return {
    accept: 'application/json; charset=utf-8',
    'content-type': 'application/json',
    isrdomain: ring.isrdomain,
    'accept-language': 'en',
    platform: 'mobile',
    'user-agent': RING_USER_AGENT,
  };
}

export type { IRingConstants };
export { AMEX_RING, ISRACARD_RING, RING_WALLET_ID, ringStaticHeaders };
