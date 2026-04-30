/**
 * OneZero IApiDirectCallConfig literal — data-only bank surface.
 * Describes the 5-step identity-server SMS-OTP flow OneZero uses
 * to mint its gateway JWT. No signer, no fingerprint, no cookie
 * jar — just POSTs with plain JSON bodies and /resultData/*
 * response extraction.
 *
 * Warm-start: creds.otpLongTermToken is the output of step-3
 * (/otp/verify), so the warm path pre-seeds carry.otpToken and
 * starts iterating from step-3-end (i.e. step 3). Steps 4+5
 * (getIdToken, sessionToken) always run to produce the final
 * Bearer token.
 *
 * Zero bank knowledge in ApiDirectCall mediator — this file is
 * the whole bank surface for login.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** OneZero config literal — seeded into PIPELINE_BANK_CONFIG[OneZero]. */
const ONEZERO_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'bearer',
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'otpToken',
    fromStepIndex: 3,
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
