/**
 * OneZero IApiDirectCallConfig literal — data-only bank surface.
 * Describes the 5-step identity-server SMS-OTP flow OneZero uses
 * to mint its gateway JWT. No signer, no fingerprint, no cookie
 * jar — just POSTs with plain JSON bodies and /resultData/*
 * response extraction.
 *
 * Warm-start: creds.otpLongTermToken holds the durable `idToken` minted by
 * /getIdToken, so the warm path pre-seeds carry.idToken and re-runs only the
 * final /sessions/token step to mint a fresh access token. See
 * ONEZERO_LOGIN_STEPS for why that artifact, and not an earlier one, is the
 * handle we keep.
 *
 * Zero bank knowledge in ApiDirectCall mediator — this file is
 * the whole bank surface for login.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/**
 * The five login steps, in order.
 *
 * Extracted so `warmStart.fromStepIndex` can be derived from the step that
 * actually mints the persisted artifact, rather than hardcoded. The invariant
 * is "resume immediately after the step that produces `carryField`" — deriving
 * it keeps the resume point correct wherever a future step is inserted.
 *
 * Which artifact survives a warm start is decided here. `/otp/verify` yields
 * an `otpToken` the bank retires after about an hour, and the warm path only
 * ever consumes it — so persisting it froze warm start at the lifetime of the
 * original SMS login and then silently degraded to a fresh OTP (issue #576).
 * `/getIdToken` yields the long-lived `idToken` the official app itself
 * replays, so that is the artifact we persist.
 *
 * Assumption on record: the relative lifetimes come from the capture in issue
 * #576, not from our own measurement. If warm start regresses, re-check them
 * by decoding `iat`/`exp` on both artifacts.
 */
const ONEZERO_LOGIN_STEPS: IApiDirectCallConfig['steps'] = [
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
];

/** Carry field holding the artifact warm start persists between runs. */
const WARM_START_CARRY_FIELD = 'idToken';

/** Index of the step whose response mints {@link WARM_START_CARRY_FIELD}. */
const MINTING_STEP_INDEX = ONEZERO_LOGIN_STEPS.findIndex(
  step => WARM_START_CARRY_FIELD in step.extractsToCarry,
);

/** OneZero config literal — seeded into PIPELINE_BANK_CONFIG[OneZero]. */
const ONEZERO_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'bearer',
  // Matches Pepper and PayBox: lets pickWarmSeed retire a stale stored token
  // client-side instead of spending a round-trip to learn it from the bank,
  // and makes a legacy non-JWT token fall through to the cold path, so an
  // upgrade heals itself on the next run.
  jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: WARM_START_CARRY_FIELD,
    // Resume right after the step that mints the stored artifact: everything
    // before it is already satisfied by the seed, and everything after it —
    // the short-lived access token — must be minted fresh on every run.
    fromStepIndex: MINTING_STEP_INDEX + 1,
  },
  probe: { queryTag: 'customer' },
  steps: ONEZERO_LOGIN_STEPS,
};

export { ONEZERO_API_DIRECT_CALL };
export default ONEZERO_API_DIRECT_CALL;
