/**
 * PayBox 3-step SMS-OTP login step definitions (class-z bodies).
 *
 *   step 1 POST /phoneValidate  -> challenge JWT (carry.accessToken1)
 *   step 2 POST /pinValidation  -> validated flag (carry.accessToken2)
 *   step 3 POST /loginBySms     -> long-term JWT + uId (carry.token)
 *
 * Body class-z = flat root with `iv` + `signature` fields per
 * spec.txt §2. PinValidation + loginBySms run a cryptoField preHook
 * that AES-encrypts the OTP digits into a per-call /pin pointer.
 *
 * Zero bank-name leakage in mediator (Rule #11) — this file is pure
 * data; the mediator's RunStep + SmsOtpFlow already handle the
 * cryptoField + attachBodySignature hooks added in Phase A.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Shared deviceInfo block — identical across all three login steps. */
const DEVICE_INFO_BLOCK = {
  os: { $literal: 'android' as const },
  osVer: { $literal: '13' as const },
  platform: { $literal: 'google sdk_gphone64_x86_64' as const },
  platformVer: { $literal: 'TE1A.240213.009' as const },
  appVer: { $literal: '5.6.6' as const },
  uuid: { $ref: 'carry.deviceId16Hex' as const },
};

/** Step 1: /phoneValidate — submit phone, receive intermediate JWT. */
const PHONE_VALIDATE_STEP: IStepConfig = {
  name: 'bind',
  urlTag: 'identity.phoneValidate',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' as const },
      signature: { $literal: '' },
      phoneNum: { $ref: 'creds.phoneNumber' as const },
      isVoiceCall: { $literal: false },
      deviceInfo: DEVICE_INFO_BLOCK,
    },
  },
  extractsToCarry: {
    accessToken1: '/content/access_token',
  },
};

/** Step 2: /pinValidation — submit PIN-encrypted OTP, receive validated JWT. */
const PIN_VALIDATION_STEP: IStepConfig = {
  name: 'assertPassword',
  urlTag: 'identity.pinValidation',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' as const },
      signature: { $literal: '' },
      phoneNum: { $ref: 'creds.phoneNumber' as const },
      access_token: { $ref: 'carry.accessToken1' as const },
      deviceInfo: DEVICE_INFO_BLOCK,
      pinIv: { $ref: 'carry.pinIv1Hex' as const },
      pin: { $literal: '' },
    },
  },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpDigitsPlain',
    cryptoField: {
      keyRef: 'carry.otpKey',
      ivRef: 'carry.pinIv1Hex',
      outputPostfix: '\n',
      writeTo: '/pin',
      scrubFromCarry: 'otpDigitsPlain',
    },
  },
  extractsToCarry: {
    accessToken2: '/content/access_token',
    validationResult: '/content/validationResult',
  },
};

/** Step 3: /loginBySms — submit PIN-encrypted OTP, receive long-term JWT + uId. */
const LOGIN_BY_SMS_STEP: IStepConfig = {
  name: 'assertOtp',
  urlTag: 'identity.loginBySms',
  body: {
    shape: {
      iv: { $ref: 'carry.ivHex' as const },
      signature: { $literal: '' },
      phoneNum: { $ref: 'creds.phoneNumber' as const },
      access_token: { $ref: 'carry.accessToken2' as const },
      lang: { $literal: 'heb' as const },
      deviceInfo: DEVICE_INFO_BLOCK,
      pinIv: { $ref: 'carry.pinIv2Hex' as const },
      pin: { $literal: '' },
    },
  },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpDigitsPlain',
    cryptoField: {
      keyRef: 'carry.otpKey',
      ivRef: 'carry.pinIv2Hex',
      outputPostfix: '\n',
      writeTo: '/pin',
      scrubFromCarry: 'otpDigitsPlain',
    },
  },
  extractsToCarry: {
    token: '/content/access_token',
    uId: '/content/uId',
    userObjectKeys: '/content/userObject/keys',
  },
};

export { LOGIN_BY_SMS_STEP, PHONE_VALIDATE_STEP, PIN_VALIDATION_STEP };
