/**
 * Pepper IApiDirectCallConfig literal — data-only bank surface.
 * Describes the 3-step Transmit Security SMS-OTP flow Pepper uses:
 *   step 1 /api/v2/auth/bind    → challenge + session + device ids
 *   step 2 /api/v2/auth/assert  → (method=password) → sms assertion
 *   step 3 /api/v2/auth/assert  → (method=otp)      → JWT
 *
 * Signing: ECDSA-P256 DER over canonical string
 *   <path+sorted-query> %% <X-TS-Client-Version> %% <bodyJson>
 * Cookies: step 1 captures, steps 2+3 re-send.
 *
 * Warm path: creds.otpLongTermToken IS the final JWT when fresh;
 * no steps run (fromStepIndex = steps.length = 3).
 *
 * Durable path (opt-in): `persistentAuth` renews an expired JWT on the
 * already-bound device via /auth/login + one password assertion — no bind,
 * no OTP. `clientInstanceId` is one UUID per flow, reused as `CellPhoneID`.
 *
 * Zero bank knowledge in ApiDirectCall mediator — this file is the
 * whole bank surface for login (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  PEPPER_FINGERPRINT,
  STATIC_HEADERS,
  TS_CLIENT_VERSION,
} from './PipelineBankConfigPepperFingerprint.js';
import { PEPPER_RESUME_STEPS } from './PipelineBankConfigPepperResumeSteps.js';
import { ASSERT_OTP_STEP, ASSERT_PWD_STEP, BIND_STEP } from './PipelineBankConfigPepperSteps.js';

/** Pepper config literal — seeded into PIPELINE_BANK_CONFIG[PEPPER]. */
const PEPPER_API_DIRECT_CALL: IApiDirectCallConfig = {
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
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'Content-Signature',
    schemeTag: 4,
    canonical: {
      parts: ['pathAndQuery', 'clientVersion', 'bodyJson'],
      separator: '%%',
      escapeFrom: '%%',
      escapeTo: String.raw`\%`,
      sortQueryParams: true,
      clientVersion: TS_CLIENT_VERSION,
    },
  },
  fingerprint: PEPPER_FINGERPRINT,
  probe: { queryTag: 'customer' },
  steps: [BIND_STEP, ASSERT_PWD_STEP, ASSERT_OTP_STEP],
  seedCarryFromCreds: [{ field: 'clientInstanceId', bootstrap: { kind: 'random-uuid' } }],
  persistentAuth: {
    provider: 'pepper',
    resumeSteps: PEPPER_RESUME_STEPS,
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'phoneNumber',
    freshnessMarginSeconds: 300,
  },
};

export { PEPPER_API_DIRECT_CALL };
export default PEPPER_API_DIRECT_CALL;
