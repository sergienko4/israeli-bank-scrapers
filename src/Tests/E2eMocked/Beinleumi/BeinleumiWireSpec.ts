/**
 * Beinleumi wire spec — what the approved FIBI protocol (spec §11.2) pins on
 * the wire: the bank's origin, its portal, app and bank ids, the path of every
 * call, and the header values the client must send. Each value is a literal
 * copied from the approved protocol, never imported from the bank config, so
 * a regression in the config's constants fails the mocked bank instead of
 * moving it along.
 *
 * Rule #18: every value here is SYNTHETIC or public protocol text. No real PII.
 */

/** The one origin every portal, Transmit, SSO and data call names. */
export const BN_ORIGIN = 'https://online.fibi.co.il';

/** The portal the login page belongs to. */
export const BN_PORTAL_ID = 'FIBIPORTAL';

/** The Transmit app every Transmit call names as `aid`. */
export const BN_AID = 'rest_app_031';

/** The bank number the login page states and the login call names. */
export const BN_BANK_NUM = '031';

/** The provider a stored device state is bound to. */
export const BN_PROVIDER = 'beinleumi-web';

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

/** The login page's query: the private-customer portal, in Hebrew. */
export const ENTRY_QUERY = { bankId: BN_PORTAL_ID, site: 'Private', KODSAFA: 'HE' } as const;

/** The login page. */
export const BN_ENTRY_URL = `${BN_ORIGIN}${WIRE_PATHS.servlet}?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;

/** The User-Agent every login and data call sends. */
export const WIRE_UA = 'BankApiInteroperabilityResearch/1.0';

/** The Transmit web SDK's version header and pre-session authorization. */
export const TS_CLIENT_VERSION = '7.3.0;[11]';
export const TS_AUTHORIZATION = 'TSToken null; tid=null';

/** The media type of the portal pages, and the Accept the portal pages are asked with. */
export const HTML_TYPE = 'text/html';
export const PAGE_ACCEPT = 'text/html,application/xhtml+xml';
