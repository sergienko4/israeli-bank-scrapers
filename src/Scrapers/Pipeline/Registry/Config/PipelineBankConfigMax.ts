/**
 * Max IApiDirectCallConfig literal and headless block — data-only bank
 * surface.
 *
 * Password login with no OTP, on the web app's own API:
 *   step 0 prime  → GET clientcontext; the bank sets its pre-login cookies
 *   step 1 login  → POST username + password; the bank sets the session cookie
 *
 * The session is a cookie, not an auth header, so the scheme is `'none'` and
 * the node transport keeps the run's cookies. Every call carries the run's
 * session id (`sid`) and a fresh correlation id. The session id is the
 * flow id the mediator mints for each run, so no credential can set it.
 *
 * Login reports its result in `Result.LoginStatus`: 0 means success, 1 asks
 * for a new password, 4 rejects the credentials; any other value is a
 * generic failure. There is no stored token, so every run logs in cold. The
 * scheme still declares `'sms-otp'`: no step has an OTP pre-hook, so the flow
 * never asks for a code.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { MAX_ORIGIN, MAX_STATIC_HEADERS } from './PipelineBankConfigMaxConstants.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/** Per-call headers: the run's flow id as the session id, and a fresh correlation id. */
const MAX_CALL_HEADERS = { sid: { $ref: 'carry.flowId' }, cid: { $ref: 'uuid' } } as const;

/** Step 0 — read the client context; the bank answers with its pre-login cookies. */
const PRIME_STEP: IStepConfig = {
  name: 'prime',
  urlTag: 'auth.prime',
  method: 'GET',
  headers: MAX_CALL_HEADERS,
  extractsToCarry: {},
};

/** Step 1 — username and password; the `id` field is sent as null. */
const LOGIN_STEP: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  body: {
    shape: {
      username: { $ref: 'creds.username' },
      password: { $ref: 'creds.password' },
      id: { $literal: null },
    },
  },
  headers: MAX_CALL_HEADERS,
  extractsToCarry: {},
  outcome: {
    codePointer: '/Result/LoginStatus',
    successCodes: ['0'],
    failureMap: {
      '1': ScraperErrorTypes.ChangePassword,
      '4': ScraperErrorTypes.InvalidPassword,
    },
    defaultFailure: ScraperErrorTypes.Generic,
  },
};

/** Max call-config literal — passed to `.withApiDirect(...)`. */
const MAX_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  staticHeaders: MAX_STATIC_HEADERS,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  steps: [PRIME_STEP, LOGIN_STEP],
};

/** Max headless endpoints. Every path is a full URL, registered verbatim. */
const MAX_HEADLESS: ITransportConfig = {
  identityBase: `${MAX_ORIGIN}/`,
  // Max has no GraphQL; graphql mirrors identityBase to satisfy the type.
  graphql: `${MAX_ORIGIN}/`,
  paths: {
    'auth.prime': `${MAX_ORIGIN}/api/registered/clientcontext`,
    'auth.login': `${MAX_ORIGIN}/api/login/login`,
  },
  // The web API answers a plain Node client; its session rides on cookies.
  nativeFetch: true,
  sessionCookies: true,
};

export default MAX_API_DIRECT_CALL;
export { MAX_API_DIRECT_CALL, MAX_HEADLESS };
