/**
 * PayBox IApiDirectCallConfig literal — data-only bank surface.
 * Describes the 3-step PayBox SMS-OTP flow that yields the long-term
 * JWT plus uId per spec.txt §3.1-§3.3:
 *   step 1 POST /phoneValidate  -> intermediate JWT
 *   step 2 POST /pinValidation  -> validated flag
 *   step 3 POST /loginBySms     -> long-term JWT + uId
 *
 * Signing: AES-CBC-PKCS7 over canonical string `tsMs|deviceId` per
 * spec.txt §4.2. Signature lands at body pointer /signature (class-z)
 * — the attachBodySignature hook (Phase A) handles this generically.
 *
 * Warm path: creds.otpLongTermToken IS the final JWT when fresh;
 * no steps run (fromStepIndex = steps.length = 3).
 *
 * Zero bank knowledge in ApiDirectCall mediator — this file is the
 * whole bank surface for login (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import {
  LOGIN_BY_SMS_STEP,
  PHONE_VALIDATE_STEP,
  PIN_VALIDATION_STEP,
} from './PipelineBankConfigPayBoxSteps.js';

/** Static request headers (every PayBox call) — see spec.txt §1. */
const STATIC_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'User-Agent': 'okhttp/4.12.0',
  'Accept-Encoding': 'gzip',
  'access-control-allow-origin': 'https://apipin.payboxapp.com/api/2.0/',
};

/** PayBox config literal — seeded into PIPELINE_BANK_CONFIG[PAYBOX]. */
const PAYBOX_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'raw',
  staticHeaders: STATIC_HEADERS,
  jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'token',
    fromStepIndex: 3,
  },
  signer: {
    algorithm: 'AES-CBC-PKCS7',
    keyRef: 'config.signKey',
    ivStrategy: 'random-16',
    bodySignatureField: '/signature',
    outputPostfix: '\n',
    canonical: {
      parts: ['tsMs', 'deviceId'],
      separator: '|',
      escapeFrom: '|',
      escapeTo: String.raw`\|`,
      sortQueryParams: false,
      clientVersion: '5.6.6',
    },
  },
  probe: { urlTag: 'data.getUserHistory' },
  steps: [PHONE_VALIDATE_STEP, PIN_VALIDATION_STEP, LOGIN_BY_SMS_STEP],
};

export { PAYBOX_API_DIRECT_CALL, STATIC_HEADERS };
export { SIGN_KEY } from './PipelineBankConfigPayBoxCrypto.js';
export default PAYBOX_API_DIRECT_CALL;
