/**
 * Discount IApiDirectCallConfig literal and headless block — data-only bank
 * surface.
 *
 * Password login with no OTP on the bank's own web API, then the handoff to
 * the retail app (steps in `PipelineBankConfigDiscountSteps.ts`):
 *   step 1 prime         → GET the login page with the routing cookies set
 *   step 2 encryptionKey → POST the app context; the bank answers its RSA key
 *   step 3 logon         → POST the formatted id, with the user code and the
 *                          password sealed under that key
 *   step 4 landing       → GET the retail app with the login cookie set
 *
 * The id is formatted before any call, as the web app does: nine digits or
 * fewer are padded to nine behind `00001`, ten digits starting with 9 sit
 * behind `0000`, and anything else fails the run. The login answer must
 * echo the formatted id's MD5 as `MI6`. Any `Error`, `error` or
 * `actionRequired` in an answer fails the run; a login `Status` other than
 * `SUCCESS` rejects the credentials. The bank's own text never reaches the
 * error.
 *
 * The session is cookies, not an auth header, so the scheme is `'none'` and
 * the node transport keeps one cookie jar for the telebank domain. Any
 * redirect fails the run except the two hops the steps name. There is no
 * stored token, so every run logs in cold. The scheme still declares
 * `'sms-otp'`: no step has an OTP pre-hook, so the flow never asks for a code.
 */

import type {
  IApiDirectCallConfig,
  IFormatRule,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  DISCOUNT_LOGIN_PAGE,
  DISCOUNT_ORIGIN,
  DISCOUNT_STATIC_HEADERS,
} from './PipelineBankConfigDiscountConstants.js';
import { DISCOUNT_LOGIN_STEPS } from './PipelineBankConfigDiscountSteps.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/** The id formats the web app sends; each pattern must match the whole id. */
const UID_FORMATS: readonly IFormatRule[] = [
  { pattern: String.raw`\d{1,9}`, prefix: '00001', padStart: 9 },
  { pattern: String.raw`9\d{9}`, prefix: '0000' },
];

/** The cookie values the steps set, read through `config.secrets.<name>`. */
const DISCOUNT_COOKIE_VALUES: Readonly<Record<string, string>> = Object.freeze({
  cssName: 'discount',
  language: 'HEBREW',
  t: 'P',
  caller: 'internet',
  fte: 'true',
  newRetail: '1',
});

/** Discount call-config literal — passed to `.withApiDirect(...)`. */
const DISCOUNT_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  staticHeaders: DISCOUNT_STATIC_HEADERS,
  secrets: DISCOUNT_COOKIE_VALUES,
  requiredCreds: { id: 'digits', password: 'latin1', num: 'latin1' },
  derivedCarry: [
    { into: 'uid', parts: ['creds.id'], op: { kind: 'format', rules: UID_FORMATS } },
    { into: 'uidMd5', parts: ['carry.uid'], op: { kind: 'md5-hex' } },
  ],
  steps: DISCOUNT_LOGIN_STEPS,
};

/** Discount headless endpoints. Every path is a full URL, registered verbatim. */
const DISCOUNT_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: `${DISCOUNT_ORIGIN}/`,
  // Discount has no GraphQL; graphql mirrors identityBase to satisfy the type.
  graphql: `${DISCOUNT_ORIGIN}/`,
  paths: {
    'auth.prime': DISCOUNT_LOGIN_PAGE,
    'auth.encryptionKey': `${DISCOUNT_ORIGIN}/Lobby/gatewayAPI/verification/getInfo`,
    'auth.logon': `${DISCOUNT_ORIGIN}/Lobby/gatewayAPI/login`,
    'auth.landing': `${DISCOUNT_ORIGIN}/apollo/retail3`,
  },
  // One jar for the telebank domain; the cookie sentinels and the cookies
  // the steps set resolve only through it.
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['telebank.co.il'],
  redirectPolicy: 'reject',
};

export default DISCOUNT_API_DIRECT_CALL;
export { DISCOUNT_API_DIRECT_CALL, DISCOUNT_HEADLESS };
