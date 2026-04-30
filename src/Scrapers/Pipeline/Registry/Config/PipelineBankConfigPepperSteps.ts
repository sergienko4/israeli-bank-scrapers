/**
 * Pepper SMS-OTP step definitions — split from PipelineBankConfigPepper.ts
 * to keep each file under 150 lines. Zero bank knowledge in mediator;
 * this file is pure data (Rule #11 compliant).
 */

import { AID, APK_VERSION, LOCALE } from './PipelineBankConfigPepperFingerprint.js';

/** Step 1: /auth/bind — device-key registration + fingerprint upload. */
const BIND_STEP = {
  name: 'bind' as const,
  urlTag: 'auth.bind' as const,
  queryTemplate: {
    aid: { $literal: AID },
    locale: { $literal: LOCALE },
    tsm: { $ref: 'nowMs' as const },
  },
  body: {
    shape: {
      headers: [
        {
          type: { $literal: 'flow_id' },
          flow_id: { $ref: 'carry.flowId' as const },
        },
        {
          type: { $literal: 'uid' },
          uid: { $ref: 'creds.phoneNumber' as const },
        },
      ],
      data: {
        collection_result: { $ref: 'fingerprint' as const },
        public_key: {
          key: { $ref: 'keypair.ec.publicKeyBase64' as const },
          type: { $literal: 'ec' },
        },
        encryption_public_key: {
          key: { $ref: 'keypair.rsa.publicKeyBase64' as const },
          type: { $literal: 'rsa' },
        },
        params: {
          CellPhoneID: { $ref: 'uuid' as const },
          Version_App: { $literal: APK_VERSION },
          transactionId: { $ref: 'uuid' as const },
        },
      },
    },
  },
  extractsToCarry: {
    challenge: '/data/challenge',
    pwdAssertionId: '/data/control_flow/0/methods/?type=password/assertion_id',
    sessionId: '/headers/*session_id',
    deviceId: '/headers/*device_id',
  },
  cookieJar: true,
};

/** Step 2: /auth/assert (method=password) — submit PIN, get SMS assertion id. */
const ASSERT_PWD_STEP = {
  name: 'assertPassword' as const,
  urlTag: 'auth.assert' as const,
  queryTemplate: {
    aid: { $literal: AID },
    did: { $ref: 'carry.deviceId' as const },
    sid: { $ref: 'carry.sessionId' as const },
    locale: { $literal: LOCALE },
    tsm: { $ref: 'nowMs' as const },
  },
  body: {
    shape: {
      headers: [
        {
          type: { $literal: 'flow_id' },
          flow_id: { $ref: 'carry.flowId' as const },
        },
        {
          type: { $literal: 'uid' },
          uid: { $ref: 'creds.phoneNumber' as const },
        },
      ],
      data: {
        action: { $literal: 'authentication' },
        assert: { $literal: 'authenticate' },
        assertion_id: { $ref: 'carry.pwdAssertionId' as const },
        fch: { $ref: 'carry.challenge' as const },
        data: { password: { $ref: 'creds.password' as const } },
        method: { $literal: 'password' },
      },
    },
  },
  extractsToCarry: {
    smsAssertionId: '/data/control_flow/0/methods/*channels/?type=sms/assertion_id',
  },
  cookieJar: true,
};

/** Step 3: /auth/assert (method=otp) — submit OTP, get final JWT. */
const ASSERT_OTP_STEP = {
  name: 'assertOtp' as const,
  urlTag: 'auth.assert' as const,
  queryTemplate: {
    aid: { $literal: AID },
    did: { $ref: 'carry.deviceId' as const },
    sid: { $ref: 'carry.sessionId' as const },
    locale: { $literal: LOCALE },
    tsm: { $ref: 'nowMs' as const },
  },
  body: {
    shape: {
      headers: [
        {
          type: { $literal: 'flow_id' },
          flow_id: { $ref: 'carry.flowId' as const },
        },
        {
          type: { $literal: 'uid' },
          uid: { $ref: 'creds.phoneNumber' as const },
        },
      ],
      data: {
        action: { $literal: 'authentication' },
        assert: { $literal: 'authenticate' },
        assertion_id: { $ref: 'carry.smsAssertionId' as const },
        fch: { $ref: 'carry.challenge' as const },
        data: { otp: { $ref: 'carry.otpCode' as const } },
        method: { $literal: 'otp' },
      },
    },
  },
  extractsToCarry: { token: '/data/token' },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpCode',
  },
  cookieJar: true,
};

export { ASSERT_OTP_STEP, ASSERT_PWD_STEP, BIND_STEP };
