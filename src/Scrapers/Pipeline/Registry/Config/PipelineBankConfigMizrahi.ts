/**
 * Mizrahi IApiDirectCallConfig literal and headless block — data-only bank
 * surface.
 *
 * Password login with no OTP, on the web app's own API, then the session
 * handoff to the online-banking host:
 *   step 0 bootstrap → GET the login page; the bank sets its XSRF cookie
 *   step 1 login     → POST username + password, echoing the XSRF cookie
 *   step 2 landing   → GET the online-banking page through its own redirects
 *   step 3 logon     → POST the app's metadata; the bank answers with the
 *                      accounts and the data token's first half
 *
 * Every data call carries `mizrahixsrftoken`: logon's `xsrfToken`, `###3`
 * and logon's `skyserid` header (empty when the bank sends none).
 *
 * The session is cookies, not an auth header, so the scheme is `'none'` and
 * the node transport keeps one cookie jar for both hosts. Any redirect
 * fails the run except the landing hops, which must stay on the landing
 * page. Login reports its result in `ReturnCode`: 1 means success, 2 rejects
 * the credentials, 4 asks for a new password and 5 means a blocked account;
 * any other value is a generic failure, and the bank's own text never
 * reaches it. There is no stored token, so every run logs in cold. The
 * scheme still declares `'sms-otp'`: no step has an OTP pre-hook, so the
 * flow never asks for a code.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';
import {
  MIZRAHI_DOCUMENT_HEADERS,
  MIZRAHI_LANDING_URL,
  MIZRAHI_MTO,
  MIZRAHI_MTO_POST_HEADERS,
  MIZRAHI_STATIC_HEADERS,
  MIZRAHI_WEB,
  MIZRAHI_WEB_POST_HEADERS,
} from './PipelineBankConfigMizrahiConstants.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/** The only page the landing hops may reach. */
const LANDING_PATHS = ['/Online/Default.aspx'];

/** The app metadata logon sends, byte for byte. */
const LOGON_BODY = { appId: 'skyWeb', appVer: '', lang: 'he-il', isPdf: false };

const DOCUMENT_HEADERS = literalHeaders(MIZRAHI_DOCUMENT_HEADERS);
const WEB_POST_HEADERS = literalHeaders(MIZRAHI_WEB_POST_HEADERS);
const MTO_POST_HEADERS = literalHeaders(MIZRAHI_MTO_POST_HEADERS);

/** Step 0 — load the login page; the bank answers with its XSRF cookie. */
const BOOTSTRAP_STEP: IStepConfig = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  method: 'GET',
  response: 'document',
  headers: DOCUMENT_HEADERS,
  extractsToCarry: {},
};

/** Step 1 — username and password, with the XSRF cookie echoed as a header. */
const LOGIN_STEP: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  body: {
    shape: { Username: { $ref: 'creds.username' }, Password: { $ref: 'creds.password' } },
  },
  headers: { ...WEB_POST_HEADERS, 'x-xsrf-token': { $literal: '@cookie:XSRF-TOKEN' } },
  extractsToCarry: {},
  outcome: {
    codePointer: '/ReturnCode',
    successCodes: ['1'],
    failureMap: {
      '2': ScraperErrorTypes.InvalidPassword,
      '4': ScraperErrorTypes.ChangePassword,
      '5': ScraperErrorTypes.AccountBlocked,
    },
    defaultFailure: ScraperErrorTypes.Generic,
  },
};

/** Step 2 — open online banking; follow only its hops back to the landing page. */
const LANDING_STEP: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  response: 'document',
  headers: DOCUMENT_HEADERS,
  extractsToCarry: {},
  redirect: {
    maxHops: 3,
    allow: [
      { origin: MIZRAHI_MTO, paths: LANDING_PATHS, exactQuery: true },
      { origin: MIZRAHI_MTO, paths: LANDING_PATHS, query: { language: 'he-IL' }, exactQuery: true },
    ],
  },
};

/** Step 3 — start the app session; carry the accounts and compose the data token. */
const LOGON_STEP: IStepConfig = {
  name: 'logon',
  urlTag: 'auth.logon',
  body: { shape: { $literal: LOGON_BODY } },
  headers: MTO_POST_HEADERS,
  extractsToCarry: { xsrfToken: '/body/xsrfToken', accounts: '/body/user/Accounts' },
  headerExtractsToCarry: { skyserid: { header: 'skyserid', fallback: '' } },
  deriveCarry: [
    { into: 'mizrahiXsrf', parts: ['carry.xsrfToken', 'carry.skyserid'], separator: '###3' },
  ],
};

/** Mizrahi call-config literal — passed to `.withApiDirect(...)`. */
const MIZRAHI_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  staticHeaders: MIZRAHI_STATIC_HEADERS,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  steps: [BOOTSTRAP_STEP, LOGIN_STEP, LANDING_STEP, LOGON_STEP],
};

/** Mizrahi headless endpoints. Every path is a full URL, registered verbatim. */
const MIZRAHI_TRANSPORT: ITransportConfig = {
  identityBase: `${MIZRAHI_WEB}/`,
  // Mizrahi has no GraphQL; graphql mirrors identityBase to satisfy the type.
  graphql: `${MIZRAHI_WEB}/`,
  paths: {
    'auth.bootstrap': `${MIZRAHI_WEB}/login/index.html`,
    'auth.login': `${MIZRAHI_WEB}/login/api/Login/LoginUser`,
    'auth.landing': MIZRAHI_LANDING_URL,
    'auth.logon': `${MIZRAHI_MTO}/Online/api/SkyBL/logon`,
  },
  // One cookie jar spans both hosts; a cookie set for the parent domain
  // reaches each of them, a host-only cookie stays on its host.
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['mizrahi-tefahot.co.il'],
  redirectPolicy: 'reject',
  statusPolicy: { 204: 'empty' },
  omitBankText: MIZRAHI_API_DIRECT_CALL.omitBankText,
};

export default MIZRAHI_API_DIRECT_CALL;
export { MIZRAHI_API_DIRECT_CALL, MIZRAHI_TRANSPORT };
