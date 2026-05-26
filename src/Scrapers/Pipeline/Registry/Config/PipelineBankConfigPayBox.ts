/**
 * PayBox IApiDirectCallConfig literal — data-only bank surface.
 *
 * Describes the 3-step Discount-Bank-PayBox SMS-OTP flow:
 *   step 1 POST /phoneValidate   → access_token1 + triggers SMS
 *   step 2 POST /pinValidation   → access_token2 (OTP digits encrypted)
 *   step 3 POST /loginBySms      → final JWT + uId  (OTP digits again)
 *
 * Signing: AES-256-CBC-PKCS7 over canonical `<tsMs>|<deviceId>` —
 * signature emitted as base64 + trailing `\n`, written into the
 * body `/signature` pointer (class-z); the scrape shape reuses the
 * same primitive with pointer `/auth/signature` (class-y).
 *
 * Warm path: creds.otpLongTermToken IS the final JWT (carry.token)
 * when the cached value is JWT-fresh; no steps run
 * (fromStepIndex = steps.length = 3).
 *
 * Carry seeds:
 *   - deviceId16Hex — sha256(creds.phoneNumber).slice(0,16). Stable
 *     across runs so the warm-start path works without callers
 *     persisting the value (server has bound the JWT to pl.uuid).
 *
 * Derived carry:
 *   - otpKey = (deviceId16Hex + '|' + PIN_SUFFIX).slice(0,32). Used
 *     as the AES-256 key for OTP cipher (per-step cryptoField hook).
 *
 * PayBox has no bare-body probe endpoint — every post-login call
 * requires the class-y `auth: { … }` envelope which only the scrape
 * shape can hydrate. The customer step doubles as the smoke test.
 *
 * Zero PayBox-name leakage in the mediator (Rule #11): this file +
 * PipelineBankConfigPayBox*.ts is the entire bank surface for login.
 */

import { randomUUID } from 'node:crypto';

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { PAYBOX_LOGIN_SIGNER, PAYBOX_SECRETS } from './PipelineBankConfigPayBoxCrypto.js';
import {
  LOGIN_BY_SMS_STEP,
  PHONE_VALIDATE_STEP,
  PIN_VALIDATION_STEP,
} from './PipelineBankConfigPayBoxSteps.js';

/**
 * Per-process session UUID echoed in the `pbsession` header on every
 * PayBox call. The real Android app generates this UUID once per
 * install / session and re-sends it on every call (validated against
 *  flow [00]
 * → [06], same value across all calls in the captured session). PayBox
 * appears to use it for server-side session correlation rather than
 * auth; one UUID per Node process is the closest analog and works for
 * single-scrape lifetimes.
 */
const PAYBOX_PB_SESSION = randomUUID();

/**
 * Static request headers every PayBox call carries — values lifted from
 * the real Android-app mitm capture
 * (,
 * extracted via `dump-flow-bodies.py 4`). The full header set is
 * load-bearing — the app's server rejects requests that omit
 * `pbsession` / `x-dynatrace` / `access-control-allow-origin` /
 * `pb-rt-bucket` with a `{code, name, message, explanation}` error
 * envelope even when the body cryptography is correct.
 *
 * - `access-control-allow-origin` is unusual as a REQUEST header but
 *   the real app emits it (recon §1.1: "client sends this header — yes
 *   really").
 * - `x-dynatrace` is the Android Dynatrace SDK's trace tag — the
 *   captured value is session-scoped; we re-use the literal as long as
 *   PayBox tolerates it (initial integration evidence).
 * - `pb-rt-bucket` varies per endpoint in the capture (`0` on
 *   /phoneValidate, `8` on /loginBySms). Using `0` matches the first
 *   login step's capture; if downstream calls reject we'll move the
 *   header to per-step `extraHeaders` and vary by endpoint.
 */
const PAYBOX_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json; charset=UTF-8',
  'User-Agent': 'okhttp/4.12.0',
  'Accept-Encoding': 'gzip',
  'access-control-allow-origin': 'https://apipin.payboxapp.com/api/2.0/',
  'pb-rt-bucket': '0',
  pbsession: PAYBOX_PB_SESSION,
  'x-dynatrace': 'MT_3_1_1330423967_1-0_e342ec24-101d-44ae-a530-a6f38c018350_14_163_41',
});

/**
 * Default values for the class-y `auth: { … }` body envelope every
 * post-login PayBox call carries. Lifted from the real-Android-app
 * mitm capture (flow [05]). Centralised here so the scrape shape
 * reads them via a single import — bumping the captured app version
 * is a config-only change.
 *
 * - `appVer` mirrors the `versionName` from the APK manifest at
 *   capture time. PayBox does not currently reject older app
 *   versions, but the value is part of the signed envelope.
 * - `os` is the captured device's Android version string.
 * - `type` is the PayBox-internal product code (`pb` = PayBox app
 *   itself, as opposed to web/SDK clients).
 */
const PAYBOX_AUTH_ENVELOPE_DEFAULTS: Readonly<{
  readonly appVer: string;
  readonly os: string;
  readonly type: string;
}> = Object.freeze({
  appVer: '5.6.6',
  os: 'android-13',
  type: 'pb',
});

/**
 * Login steps in execution order. Declared as a `const` so
 * `warmStart.fromStepIndex` can be derived from `.length`, avoiding
 * a hardcoded `3` that drifts out of sync when steps are added or
 * removed.
 */
const PAYBOX_LOGIN_STEPS = [PHONE_VALIDATE_STEP, PIN_VALIDATION_STEP, LOGIN_BY_SMS_STEP] as const;

/** PayBox call-config literal — seeded into PIPELINE_BANK_CONFIG[PayBox]. */
const PAYBOX_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'raw',
  staticHeaders: PAYBOX_STATIC_HEADERS,
  secrets: PAYBOX_SECRETS,
  jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'token',
    // Skip every login step on the warm path — the cached JWT IS
    // the final token. Derived from steps.length so adding or
    // removing a step keeps the warm-skip range aligned.
    fromStepIndex: PAYBOX_LOGIN_STEPS.length,
  },
  signer: PAYBOX_LOGIN_SIGNER,
  seedCarryFromCreds: [
    { field: 'deviceId16Hex', bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' } },
    // Warm-start seeds: extract `uId` from the cached JWT's `pl.uId`
    // claim so the class-y scrape bodies can reference `$ref: carry.uId`
    // even when the login steps that would otherwise extract it are
    // skipped via `warmStart.fromStepIndex`. Marked `optional: true`
    // so the cold path (no cached `otpLongTermToken` in creds) doesn't
    // fail at carry init — the SMS-OTP flow's third step
    // (`LOGIN_BY_SMS_STEP.extractsToCarry.uId`) fills the same slot
    // from the live login response.
    {
      field: 'uId',
      bootstrap: {
        kind: 'jwt-claim',
        from: 'otpLongTermToken',
        claim: 'pl.uId',
        optional: true,
      },
    },
  ],
  derivedCarry: [
    {
      into: 'otpKey',
      parts: ['carry.deviceId16Hex', 'config.secrets.pinSuffix'],
      separator: '|',
      truncateBytes: 32,
    },
  ],
  steps: [...PAYBOX_LOGIN_STEPS],
};

export default PAYBOX_API_DIRECT_CALL;
export { PAYBOX_API_DIRECT_CALL, PAYBOX_AUTH_ENVELOPE_DEFAULTS };
