/**
 * Discount constants shared by the login config and the scrape shape. Login,
 * the retail app and its data API all run on one origin, and every call sends
 * the bank's routing headers, so both read them from here.
 */

/** Discount online-banking origin — login, the retail app and its data API. */
const DISCOUNT_ORIGIN = 'https://start.telebank.co.il';

/** The library's research user agent, sent on every call. */
const DISCOUNT_UA = 'BankApiInteroperabilityResearch/1.0';

/** The login page every login call is made from. */
const DISCOUNT_LOGIN_PAGE = `${DISCOUNT_ORIGIN}/login/`;

/** The retail app every Titan data call is made from. */
const DISCOUNT_RETAIL_PAGE = `${DISCOUNT_ORIGIN}/apollo/retail3/`;

/** Content type of every JSON call. */
const JSON_TYPE = 'application/json';

/**
 * Headers every call sends. The routing headers echo the bank's cookies at
 * dispatch: `language` and `site` fall back to the web app's defaults and
 * `uuid` to an empty value; `x-xsrf-token` decodes strictly and is left out
 * while the bank has set no `XSRF-TOKEN`. Empty values are sent, not
 * dropped. Names are lowercase so they replace, rather than sit beside, the
 * transport's defaults.
 */
const DISCOUNT_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'user-agent': DISCOUNT_UA,
  origin: DISCOUNT_ORIGIN,
  language: '@cookie:language?HEBREW',
  site: '@cookie:site?retail',
  uuid: '@cookie:tuuid?',
  'x-xsrf-token': '@cookie-strict:XSRF-TOKEN',
  businessprocessid: '',
});

/** Headers a login JSON call sends, as made from the login page. */
const DISCOUNT_LOGIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: JSON_TYPE,
  referer: DISCOUNT_LOGIN_PAGE,
  accountnumber: '',
});

/** Headers a login POST sends: the login set plus its content type. */
const DISCOUNT_LOGIN_POST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  ...DISCOUNT_LOGIN_HEADERS,
  'content-type': JSON_TYPE,
});

/** Headers the retail-app page load sends. */
const DISCOUNT_DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'text/html',
  referer: DISCOUNT_LOGIN_PAGE,
});

/**
 * Headers a Titan data call sends, as made from the retail app. The scrape
 * shape adds the routing headers and `accountnumber` per call.
 */
const DISCOUNT_TITAN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: JSON_TYPE,
  referer: DISCOUNT_RETAIL_PAGE,
});

export {
  DISCOUNT_DOCUMENT_HEADERS,
  DISCOUNT_LOGIN_HEADERS,
  DISCOUNT_LOGIN_PAGE,
  DISCOUNT_LOGIN_POST_HEADERS,
  DISCOUNT_ORIGIN,
  DISCOUNT_STATIC_HEADERS,
  DISCOUNT_TITAN_HEADERS,
  DISCOUNT_UA,
};
