/**
 * Beinleumi wire spec — what the approved FIBI protocol pins on
 * the wire for every Beinleumi group bank: the path of every call and the
 * header values the client must send. Each value is a literal copied from the
 * approved protocol, never imported from the bank config, so a regression in
 * the config's constants fails the mocked bank instead of moving it along.
 * What differs per bank lives in `BeinleumiBrands.ts`.
 *
 * Rule #18: every value here is SYNTHETIC or public protocol text. No real PII.
 */

/** The paths every call goes to; the Transmit ones keep their double slash. */
export const WIRE_PATHS = {
  servlet: '/MatafLoginService/MatafLoginServlet',
  keyExchange: '//api/v2/auth/key_exchange',
  login: '//api/v2/auth/login',
  assert: '//api/v2/auth/assert',
  bootstrap: '/MatafRestApiService/rest/authSSO/authSSO',
  authorize: '/appsng/bff-portal-shell/api/v1/autorization/authorize',
  userData: '/MatafAngularRestApiService/rest/utils/userData',
  bff: '/appsng/bff-balancetransactions/api/v1/transactions',
} as const;

/** The User-Agent every login and data call sends. */
export const WIRE_UA = 'BankApiInteroperabilityResearch/1.0';

/** The Transmit web SDK's version header and pre-session authorization. */
export const TS_CLIENT_VERSION = '7.3.0;[11]';
export const TS_AUTHORIZATION = 'TSToken null; tid=null';

/** The media type of the portal pages, and the Accept the portal pages are asked with. */
export const HTML_TYPE = 'text/html';
export const PAGE_ACCEPT = 'text/html,application/xhtml+xml';
