/**
 * OneZero IApiDirectCallConfig literal — data-only bank surface.
 * Describes the 5-step identity-server SMS-OTP flow OneZero uses
 * to mint its gateway JWT. No signer, no fingerprint, no cookie
 * jar — just POSTs with plain JSON bodies and /resultData/*
 * response extraction.
 *
 * Warm-start: creds.otpLongTermToken carries the ~10-year idToken
 * minted by step 3 (getIdToken) — the creds field name is kept for
 * compatibility. The warm path pre-seeds carry.idToken and runs only
 * step 4 (sessionToken): steps 0-3 exist to mint that idToken, and
 * the step-2 otpToken they chain through dies within the hour, so it
 * can never seed a warm run.
 *
 * Zero bank knowledge in ApiDirectCall mediator — this file is
 * the whole bank surface for login.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** OneZero config literal — seeded into PIPELINE_BANK_CONFIG[OneZero]. */
const ONEZERO_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'bearer',
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'idToken',
    fromStepIndex: 4,
  },
  probe: { queryTag: 'customer' },
  steps: [
    {
      name: 'bind',
      urlTag: 'identity.deviceToken',
      body: {
        shape: {
          extClientId: { $literal: 'mobile' },
          os: { $literal: 'Android' },
        },
      },
      extractsToCarry: { deviceToken: '/resultData/deviceToken' },
    },
    {
      name: 'assertPassword',
      urlTag: 'identity.otpPrepare',
      body: {
        shape: {
          factorValue: { $ref: 'creds.phoneNumber' },
          deviceToken: { $ref: 'carry.deviceToken' },
          otpChannel: { $literal: 'SMS_OTP' },
        },
      },
      extractsToCarry: { otpContext: '/resultData/otpContext' },
    },
    {
      name: 'assertOtp',
      urlTag: 'identity.otpVerify',
      body: {
        shape: {
          otpContext: { $ref: 'carry.otpContext' },
          otpCode: { $ref: 'carry.otpCode' },
        },
      },
      extractsToCarry: { otpToken: '/resultData/otpToken' },
      preHook: { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otpCode' },
    },
    {
      name: 'getIdToken',
      urlTag: 'identity.getIdToken',
      body: {
        shape: {
          otpSmsToken: { $ref: 'carry.otpToken' },
          email: { $ref: 'creds.email' },
          pass: { $ref: 'creds.password' },
          pinCode: { $literal: '' },
        },
      },
      extractsToCarry: { idToken: '/resultData/idToken' },
    },
    {
      name: 'sessionToken',
      urlTag: 'identity.sessionToken',
      body: {
        shape: {
          idToken: { $ref: 'carry.idToken' },
          pass: { $ref: 'creds.password' },
        },
      },
      extractsToCarry: { token: '/resultData/accessToken' },
    },
  ],
};

export { ONEZERO_API_DIRECT_CALL };
export default ONEZERO_API_DIRECT_CALL;
