/**
 * Telebank family constants, shared by the login config and the scrape
 * shape. Discount and Mercantile run one web app on one origin — login, the
 * retail app and its data API — and every call sends the same routing
 * headers; only a brand's literals (`ITelebankBrand`) tell them apart.
 */

/** The literals that tell one Telebank bank's login from another's. */
interface ITelebankBrand {
  /** The app context's `Bank` code. */
  readonly bankCode: string;
  /** The `cssName` routing cookie the login page is opened with. */
  readonly cssName: string;
  /** The login page's path and query on the shared origin. */
  readonly loginPath: string;
  /** Put before an id of nine digits or fewer, padded to nine. */
  readonly shortUidPrefix: string;
  /** Put before a ten-digit id that starts with 9. */
  readonly longUidPrefix: string;
}

/** Telebank online-banking origin — login, the retail app and its data API. */
const TELEBANK_ORIGIN = 'https://start.telebank.co.il';

/** The library's research user agent, sent on every call. */
const TELEBANK_UA = 'BankApiInteroperabilityResearch/1.0';

/** The retail app every Titan data call is made from. */
const TELEBANK_RETAIL_PAGE = `${TELEBANK_ORIGIN}/apollo/retail3/`;

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
const TELEBANK_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'user-agent': TELEBANK_UA,
  origin: TELEBANK_ORIGIN,
  language: '@cookie:language?HEBREW',
  site: '@cookie:site?retail',
  uuid: '@cookie:tuuid?',
  'x-xsrf-token': '@cookie-strict:XSRF-TOKEN',
  businessprocessid: '',
});

/**
 * Headers a Titan data call sends, as made from the retail app. The scrape
 * shape adds the routing headers and `accountnumber` per call.
 */
const TELEBANK_TITAN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: JSON_TYPE,
  referer: TELEBANK_RETAIL_PAGE,
});

/**
 * The login page every login call is made from.
 * @param brand - Telebank brand.
 * @returns Absolute login page URL.
 */
function telebankLoginPage(brand: ITelebankBrand): string {
  return `${TELEBANK_ORIGIN}${brand.loginPath}`;
}

/**
 * Headers a login JSON call sends, as made from the brand's login page.
 * @param brand - Telebank brand.
 * @returns The header map.
 */
function telebankLoginHeaders(brand: ITelebankBrand): Readonly<Record<string, string>> {
  const referer = telebankLoginPage(brand);
  return { accept: JSON_TYPE, referer, accountnumber: '' };
}

/**
 * Headers a login POST sends: the login set plus its content type.
 * @param brand - Telebank brand.
 * @returns The header map.
 */
function telebankLoginPostHeaders(brand: ITelebankBrand): Readonly<Record<string, string>> {
  return { ...telebankLoginHeaders(brand), 'content-type': JSON_TYPE };
}

/**
 * Headers the retail-app page load sends, as made from the login page.
 * @param brand - Telebank brand.
 * @returns The header map.
 */
function telebankDocumentHeaders(brand: ITelebankBrand): Readonly<Record<string, string>> {
  const referer = telebankLoginPage(brand);
  return { accept: 'text/html', referer };
}

export type { ITelebankBrand };
export {
  TELEBANK_ORIGIN,
  TELEBANK_STATIC_HEADERS,
  TELEBANK_TITAN_HEADERS,
  TELEBANK_UA,
  telebankDocumentHeaders,
  telebankLoginHeaders,
  telebankLoginPage,
  telebankLoginPostHeaders,
};
