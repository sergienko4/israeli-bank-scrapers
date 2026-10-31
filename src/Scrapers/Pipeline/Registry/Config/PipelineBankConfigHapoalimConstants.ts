/**
 * Hapoalim constants shared by the login config and the scrape shape. Login,
 * the portal landing and every data call run on one origin, so both read the
 * origin, the header sets and the landing rules from here.
 */

import type { ISealRsaBlockXorParams } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { COOKIE_HEADER_SENTINEL_PREFIX } from '../../Strategy/Fetch/CookieHeaderSentinel.js';
import type { IUrlRule } from '../../Types/Domain/FetchPolicy.js';

/** Hapoalim's one origin: login, landing and the data API. */
const HAPOALIM_ORIGIN = 'https://login.bankhapoalim.co.il';

/** The data API under that origin. */
const HAPOALIM_API = `${HAPOALIM_ORIGIN}/ServerServices`;

/** The login page every call is made from. */
const HAPOALIM_LOGIN_PAGE = `${HAPOALIM_ORIGIN}/ng-portals/auth/he/`;

/**
 * Headers every call sends: a JSON accept, the library's own user agent and
 * the login page as referer. Names are lowercase so they replace, rather than
 * sit beside, the transport's defaults.
 */
const HAPOALIM_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'application/json',
  'user-agent': 'israeli-bank-scrapers',
  referer: HAPOALIM_LOGIN_PAGE,
});

/** Headers the login page load sends instead of the JSON accept. */
const HAPOALIM_DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'text/html',
});

/**
 * Headers every POST adds: its origin, and the XSRF cookie echoed as the
 * header the bank checks (dropped when the cookie is absent).
 */
const HAPOALIM_POST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: HAPOALIM_ORIGIN,
  'x-xsrf-token': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`,
});

/** Content type the movements POST requires, byte for byte. */
const HAPOALIM_TXNS_CONTENT_TYPE = 'application/json;charset=UTF-8';

/** The portal pages a login may point at: the app, its landing, or the legacy frame set. */
const HAPOALIM_TARGETS: readonly IUrlRule[] = [
  {
    origin: HAPOALIM_ORIGIN,
    paths: ['/ng-portals/rb/he', '/ng-portals/rb/he/', '/authenticate/landpage'],
  },
  { origin: HAPOALIM_ORIGIN, paths: ['/cgi-bin/poalwwwc'], query: { reqName: 'MainFrameSet' } },
];

/** Pointers whose presence means the bank refused the step. */
const HAPOALIM_ERRORS: readonly string[] = ['/error', '/Error', '/errors'];

/**
 * The bank's password seal, as its login page issues it. The alphabet is
 * copied as issued (`XTZ`, no `j`).
 */
const HAPOALIM_SEAL_PARAMS: ISealRsaBlockXorParams = {
  exponent: 65537,
  seedAlphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz',
  seedLength: 12,
  blockChars: 7,
  prefix: '[ENC]',
  blockSeparator: '|!|',
  envelopeTerminator: '|(!)|',
};

export {
  HAPOALIM_API,
  HAPOALIM_DOCUMENT_HEADERS,
  HAPOALIM_ERRORS,
  HAPOALIM_LOGIN_PAGE,
  HAPOALIM_ORIGIN,
  HAPOALIM_POST_HEADERS,
  HAPOALIM_SEAL_PARAMS,
  HAPOALIM_STATIC_HEADERS,
  HAPOALIM_TARGETS,
  HAPOALIM_TXNS_CONTENT_TYPE,
};
