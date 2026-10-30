/**
 * VisaCal IApiDirectCallConfig literal — data-only bank surface.
 *
 * Password login with no OTP, two POSTs on CAL's mobile gateway:
 *   step 0 regularLogin  → calConnectToken + hash
 *   step 1 bioLogin      → a fresh calConnectToken + a rotated hash
 *
 * Warm path: `creds.otpLongTermToken` is a stored hash. The run resumes at
 * bioLogin, which the bank itself validates (the hash has no readable
 * expiry). Either way the final `carry.hash` — rotated by bioLogin — becomes
 * `result.persistentOtpToken`. A rejected hash fails the warm attempt and
 * the run falls back to a cold login.
 *
 * Every response carries `statusCode`: 1 means success, 4 means the bank
 * rejected the credentials. The scheme still declares `'sms-otp'`: no step
 * has an OTP pre-hook, so the flow never asks for a code.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  IStepOutcome,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/**
 * Headers the Android app sends on every login call. Names are lowercase so
 * they replace, rather than sit beside, the transport's default
 * `content-type` (a mixed-case twin would be joined into one value).
 */
const VISACAL_LOGIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'application/json',
  'content-type': 'application/json; charset=UTF-8',
  platform: 'android',
  version: '6.26.17',
  'user-agent':
    'Mozilla/5.0 (Linux; Android 11; Pixel 3 Build/RQ1A.210105.003; wv) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36',
  'x-site-id': '8D37DF16-5812-4ACD-BAE7-CD1A5BFA2207',
});

/** Both login steps report their result in the body's `statusCode`. */
const VISACAL_OUTCOME: IStepOutcome = {
  codePointer: '/statusCode',
  successCodes: ['1'],
  failureMap: { '4': ScraperErrorTypes.InvalidPassword },
  defaultFailure: ScraperErrorTypes.Generic,
};

/** Both login steps return the session token and the long-term hash. */
const VISACAL_EXTRACTS = { token: '/result/calConnectToken', hash: '/result/hash' };

/** Step 0 — username and password, with a fresh device id per call. */
const REGULAR_LOGIN_STEP: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  body: {
    shape: {
      username: { $ref: 'creds.username' },
      password: { $ref: 'creds.password' },
      uuid: { $ref: 'uuid' },
      newPassword: { $literal: null },
    },
  },
  extractsToCarry: VISACAL_EXTRACTS,
  outcome: VISACAL_OUTCOME,
};

/** Step 1 — trade the hash for a fresh token; the warm path starts here. */
const BIO_LOGIN_STEP: IStepConfig = {
  name: 'resume',
  urlTag: 'auth.resume',
  body: { shape: { hash: { $ref: 'carry.hash' } } },
  extractsToCarry: VISACAL_EXTRACTS,
  outcome: VISACAL_OUTCOME,
};

/** VisaCal call-config literal — passed to `.withApiDirect(...)`. */
const VISACAL_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'prefixed',
  authPrefix: 'CALAuthScheme ',
  staticHeaders: VISACAL_LOGIN_HEADERS,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'hash',
    fromStepIndex: 1,
    validation: 'bank-call',
  },
  steps: [REGULAR_LOGIN_STEP, BIO_LOGIN_STEP],
};

export default VISACAL_API_DIRECT_CALL;
export { VISACAL_API_DIRECT_CALL };
