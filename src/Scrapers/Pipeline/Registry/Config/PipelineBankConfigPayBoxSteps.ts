/**
 * PayBox 3-step SMS-OTP login chain — class-z bodies.
 *
 * Step labels reuse the existing `StepName` literals (bind /
 * assertPassword / assertOtp) — they are cosmetic only (no business
 * logic switches on them) and the generic mediator doesn't need a
 * new union member.
 *
 *   phoneValidate  ≈ bind            (triggers SMS, returns access_token1)
 *   pinValidation  ≈ assertPassword  (submits OTP via cryptoField, returns access_token2)
 *   loginBySms     ≈ assertOtp       (submits OTP again, returns final JWT + uId)
 *
 * Both pinValidation and loginBySms encrypt the user's OTP digits into
 * the body `/pin` pointer via the per-step `cryptoField` hook. The
 * OTP retriever is invoked once and the result memoised inside the
 * OtpPoller helper so a single SMS code drives both calls.
 *
 * Zero PayBox-name leakage in the mediator (Rule #11): every detail
 * lives in this data literal.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** PayBox Android device fingerprint — public constants from the APK. */
const DEVICE_INFO = {
  os: { $literal: 'android' as const },
  osVer: { $literal: '13' as const },
  platform: { $literal: 'google sdk_gphone64_x86_64' as const },
  platformVer: { $literal: 'TE1A.240213.009' as const },
  appVer: { $literal: '5.6.6' as const },
  uuid: { $ref: 'carry.deviceId16Hex' as const },
} as const;

/**
 * Build a cryptoField config bound to a per-step pin-IV carry slot.
 *
 * Distinct slots per step are load-bearing: `writeCryptoIvSlot` only
 * seeds a fresh IV when the carry slot is absent (so the per-step
 * primer doesn't trample a caller-supplied IV during a re-run). If
 * `pinValidation` and `loginBySms` shared one slot, the IV would
 * persist from step 2's `mergeScopeCarry` and step 3 would reuse it
 * — PayBox's server expects distinct IVs across the two calls.
 * @param ivSlot - Carry slot name for the per-step pin IV.
 * @returns ICryptoFieldConfig literal.
 */
/** Bound cryptoField config for a single OTP-encryption step. */
interface IOtpCryptoFieldConfig<TIvSlot extends 'pinIv1' | 'pinIv2'> {
  readonly keyRef: 'carry.otpKey';
  readonly ivRef: `carry.${TIvSlot}`;
  readonly outputPostfix: string;
  readonly writeTo: string;
  readonly scrubFromCarry: string;
}

/**
 * Build a cryptoField bound to the supplied IV carry slot. Generic
 * over `TIvSlot` so the literal-typed `ivRef` survives in the result
 * — the caller can `as const` the slot name and downstream code keeps
 * the narrowed `'carry.pinIv1'` / `'carry.pinIv2'` literal type.
 * @param ivSlot - Carry slot name for the per-step pin IV.
 * @returns Bound cryptoField config for the supplied IV slot.
 */
function buildOtpCryptoField<TIvSlot extends 'pinIv1' | 'pinIv2'>(
  ivSlot: TIvSlot,
): IOtpCryptoFieldConfig<TIvSlot> {
  return {
    keyRef: 'carry.otpKey',
    ivRef: `carry.${ivSlot}`,
    outputPostfix: '\n',
    writeTo: '/pin',
    scrubFromCarry: 'otpDigitsPlain',
  };
}

/**
 * Step 1: POST /phoneValidate — triggers SMS, returns access_token1.
 * Class-z body (flat iv+signature at root).
 */
const PHONE_VALIDATE_STEP: IStepConfig = {
  name: 'bind',
  urlTag: 'identity.phoneValidate',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' },
      phoneNum: { $ref: 'creds.phoneNumber' },
      isVoiceCall: { $literal: false },
      deviceInfo: DEVICE_INFO,
    },
  },
  extractsToCarry: {
    // PayBox wraps all responses in `{ code, content: {…} }`; the
    // extractor walks into `/content/…` to reach the payload. Validated
    // against `c:/tmp/paybox-capture-2026-05-23/paybox-history.mitmflow`
    // flow [04].
    accessToken1: '/content/access_token',
  },
};

/**
 * Step 2: POST /pinValidation — submits OTP, returns access_token2.
 * Class-z body; OTP digits encrypted into `/pin` via cryptoField hook.
 */
const PIN_VALIDATION_STEP: IStepConfig = {
  name: 'assertPassword',
  urlTag: 'identity.pinValidation',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' },
      phoneNum: { $ref: 'creds.phoneNumber' },
      access_token: { $ref: 'carry.accessToken1' },
      deviceInfo: DEVICE_INFO,
      pinIv: { $ref: 'carry.pinIv1' },
    },
  },
  extractsToCarry: {
    accessToken2: '/content/access_token',
  },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpDigitsPlain',
    cryptoField: buildOtpCryptoField('pinIv1'),
  },
};

/**
 * Step 3: POST /loginBySms — finalises login, returns long-term JWT + uId.
 * Class-z body; OTP digits encrypted into `/pin` again (server expects it).
 */
const LOGIN_BY_SMS_STEP: IStepConfig = {
  name: 'assertOtp',
  urlTag: 'identity.loginBySms',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' },
      phoneNum: { $ref: 'creds.phoneNumber' },
      access_token: { $ref: 'carry.accessToken2' },
      lang: { $literal: 'heb' },
      deviceInfo: DEVICE_INFO,
      pinIv: { $ref: 'carry.pinIv2' },
    },
  },
  extractsToCarry: {
    token: '/content/access_token',
    uId: '/content/uId',
  },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpDigitsPlain',
    cryptoField: buildOtpCryptoField('pinIv2'),
  },
};

export { LOGIN_BY_SMS_STEP, PHONE_VALIDATE_STEP, PIN_VALIDATION_STEP };
