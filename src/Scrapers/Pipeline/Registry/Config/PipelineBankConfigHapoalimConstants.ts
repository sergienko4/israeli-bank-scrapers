/**
 * Hapoalim app constants shared by the login config and the scrape
 * shape. The app edge and the data gateway live on one origin, so both
 * read the origin, the header sets and the app query from here.
 *
 * The app edge is `iphone.bankhapoalim.co.il`; it speaks the same
 * `ServerServices` contracts as the portal, keyed by `appId` and the
 * app version headers instead of the browser session headers.
 */

import { COOKIE_HEADER_SENTINEL_PREFIX } from '../../Strategy/Fetch/CookieHeaderSentinel.js';
import type { IUrlRule } from '../../Types/Domain/FetchPolicy.js';

/** Hapoalim's app edge: login, device registration and the data API. */
const HAPOALIM_ORIGIN = 'https://iphone.bankhapoalim.co.il';

/** The data API under that origin. */
const HAPOALIM_API = `${HAPOALIM_ORIGIN}/ServerServices`;

/** App id every app call carries, in the query and on the OTP forms. */
const HAPOALIM_APP_ID = 'bankApp3Generation';

/** App version the login and data calls advertise. */
const HAPOALIM_APP_VERSION = '44.3.0';

/**
 * Query every app login call carries: the CA auth scheme (`mobile=ca`)
 * and the app id.
 */
const HAPOALIM_AUTH_QUERY = `appId=${HAPOALIM_APP_ID}&mobile=ca`;

/**
 * Headers every data call sends: the app identity and version set the app
 * client advertises. The transport sets the content type; the shape adds
 * the anti-replay headers on POST.
 */
const HAPOALIM_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'application/json',
  mobile: 'ca',
  'x-bnhp-app-version': HAPOALIM_APP_VERSION,
  'client-version-nbr': HAPOALIM_APP_VERSION,
  'x-app-name': HAPOALIM_APP_ID,
  'x-platform-type': 'Android',
  'x-client-type': 'mobile-app',
  'user-agent': `BankHapoalim/${HAPOALIM_APP_VERSION} (Android)`,
});

/**
 * Headers every login POST adds: the same app identity set. The app sends
 * `mobile: ca` on the CA calls and no XSRF echo until the OTP step.
 */
const HAPOALIM_AUTH_HEADERS: Readonly<Record<string, string>> = HAPOALIM_STATIC_HEADERS;

/**
 * POST headers the app data calls add: the XSRF cookie echoed as the
 * header the bank checks (dropped when the cookie is absent).
 */
const HAPOALIM_POST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-xsrf-token': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`,
});

/** Content type the movements POST requires, byte for byte. */
const HAPOALIM_TXNS_CONTENT_TYPE = 'application/json;charset=UTF-8';

/** Pointers whose presence means the bank refused the step. */
const HAPOALIM_ERRORS: readonly string[] = ['/error', '/Error', '/errors'];

/**
 * The app edge only; a redirect to any other host is refused.
 */
const HAPOALIM_TARGETS: readonly IUrlRule[] = [
  { origin: HAPOALIM_ORIGIN, paths: ['/ServerServices', '/authenticate'] },
];

export {
  HAPOALIM_API,
  HAPOALIM_APP_ID,
  HAPOALIM_APP_VERSION,
  HAPOALIM_AUTH_HEADERS,
  HAPOALIM_AUTH_QUERY,
  HAPOALIM_ERRORS,
  HAPOALIM_ORIGIN,
  HAPOALIM_POST_HEADERS,
  HAPOALIM_STATIC_HEADERS,
  HAPOALIM_TARGETS,
  HAPOALIM_TXNS_CONTENT_TYPE,
};
