/**
 * FIBI-family constants: the brand record the family's banks differ by, the
 * paths every brand serves on its own online origin, the Transmit SDK's fixed
 * values and the portal URL rule. Pure data (Rule #11).
 */

import type { IUrlRule } from '../../Types/Domain/FetchPolicy.js';
import ONLY_200_STATUS_POLICY from './PipelineBankConfigHttpStatus.js';

/** What one FIBI-family bank differs by. */
interface IFibiBrand {
  /** The online origin every login call goes to. */
  readonly origin: string;
  /** The entry page's `bankId` query value. */
  readonly portalId: string;
  /** The Transmit application id, sent as `?aid`. */
  readonly aid: string;
  /** The bank number the entry page must state. */
  readonly bankNum: string;
  /** Device-memory provider tag. */
  readonly provider: string;
}

/** The User-Agent every login call sends. */
const FIBI_UA = 'BankApiInteroperabilityResearch/1.0';

/** The web SDK's `X-TS-Client-Version`. */
const FIBI_TS_CLIENT_VERSION = '7.3.0;[11]';

/** The web SDK's pre-session `Authorization`. */
const FIBI_TS_AUTHORIZATION = 'TSToken null; tid=null';

/** Paths on the brand's online origin; the Transmit ones keep their double slash. */
const FIBI_PATHS = {
  servlet: '/MatafLoginService/MatafLoginServlet',
  keyExchange: '//api/v2/auth/key_exchange',
  login: '//api/v2/auth/login',
  assert: '//api/v2/auth/assert',
  bootstrap: '/MatafRestApiService/rest/authSSO/authSSO',
  authorize: '/appsng/bff-portal-shell/api/v1/autorization/authorize',
} as const;

/** Path texts a portal hand-off must not reach. */
const FIBI_DENIED_PATHS = ['logout', 'changepass', 'recovery', 'resetpassword'] as const;

/** Longest login page read, in chars. */
const FIBI_PAGE_MAX_CHARS = 2097152;

/** Longest SSO answer read, in chars. */
const FIBI_SSO_MAX_CHARS = 131072;

/** Media type of the login pages. */
const FIBI_HTML = 'text/html';

/** Accept of the portal pages. */
const FIBI_PAGE_ACCEPT = 'text/html,application/xhtml+xml';

/** Every 2xx status but 200: a login call answers 200 or fails. */
const FIBI_STATUS_POLICY = ONLY_200_STATUS_POLICY;

/**
 * The brand's entry page, which states the bank number and client address.
 * @param brand - FIBI-family brand.
 * @returns Absolute entry URL.
 */
function fibiEntryUrl(brand: IFibiBrand): string {
  const query = `bankId=${brand.portalId}&site=Private&KODSAFA=HE`;
  return `${brand.origin}${FIBI_PATHS.servlet}?${query}`;
}

/**
 * The login servlet the entry page's form posts to.
 * @param brand - FIBI-family brand.
 * @returns Absolute servlet URL.
 */
function fibiServletUrl(brand: IFibiBrand): string {
  return `${brand.origin}${FIBI_PATHS.servlet}`;
}

/**
 * The rule a portal hand-off URL must pass: the brand's origin, no exit path.
 * @param brand - FIBI-family brand.
 * @returns The URL rule.
 */
function fibiPortalRule(brand: IFibiBrand): IUrlRule {
  return { origin: brand.origin, anyPathExcept: FIBI_DENIED_PATHS };
}

export type { IFibiBrand };
export {
  FIBI_DENIED_PATHS,
  FIBI_HTML,
  FIBI_PAGE_ACCEPT,
  FIBI_PAGE_MAX_CHARS,
  FIBI_PATHS,
  FIBI_SSO_MAX_CHARS,
  FIBI_STATUS_POLICY,
  FIBI_TS_AUTHORIZATION,
  FIBI_TS_CLIENT_VERSION,
  FIBI_UA,
  fibiEntryUrl,
  fibiPortalRule,
  fibiServletUrl,
};
