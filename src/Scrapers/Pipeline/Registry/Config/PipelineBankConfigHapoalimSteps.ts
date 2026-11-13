/**
 * Hapoalim app login steps: identify the user on the CA edge, verify the
 * password with the captured device signature, run the SMS OTP when the
 * bank asks, then register the device on `step1-mobile`. Each step
 * refuses a reply whose `error` object is non-empty.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { HAPOALIM_ERRORS, HAPOALIM_TARGETS } from './PipelineBankConfigHapoalimConstants.js';
import { HAPOALIM_DEVICE_STEPS } from './PipelineBankConfigHapoalimDeviceSteps.js';
import {
  OTP_INIT_FORM,
  OTP_VERIFY_FORM,
  VERIFY_FORM,
} from './PipelineBankConfigHapoalimForms.js';
import { AUTH_HEADERS, REFUSED_STATES } from './PipelineBankConfigHapoalimStepShared.js';

/** The OTP steps run only when the password step asked for one. */
const OTP_PENDING = { carry: 'state', oneOf: ['logonotp'] } as const;

/** Only the app edge may be the redirect target. */
const TARGET_RULE = { url: HAPOALIM_TARGETS } as const;

/**
 * WAF warm-up before the password check. A GET to the CA edge answers a
 * self-redirect with the Incapsula cookies; accepting that answer keeps the
 * cookies for `verify`. The body is not inspected.
 */
const IDENTIFY_STEP: IStepConfig = {
  name: 'identify',
  urlTag: 'auth.identify',
  method: 'GET',
  headers: AUTH_HEADERS,
  response: 'text',
  maxTextChars: 8192,
  redirect: 'accept',
  extractsToCarry: {},
};

/** Sends the password with the device signature; asks for an OTP or lands. */
const VERIFY_STEP: IStepConfig = {
  name: 'verify',
  urlTag: 'auth.verify',
  encoding: 'form-utf8',
  body: { shape: VERIFY_FORM },
  headers: AUTH_HEADERS,
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { state: '/state' },
  optionalExtractsToCarry: {
    flow: { pointer: '/flow' },
    kdi: { pointer: '/result/deviceID' },
    newDevice: { pointer: '/result/reason' },
    target: { pointer: '/target' },
  },
  extractRules: {
    state: { transform: 'lower' },
    flow: { transform: 'lower', oneOf: ['authenticate'] },
    kdi: { type: 'string', pattern: '^.{1,2048}$' },
    newDevice: { transform: 'lower' },
    target: TARGET_RULE,
  },
  outcome: {
    codePointer: '/state',
    caseInsensitive: true,
    successCodes: ['logonotp', 'landpage'],
    failureMap: REFUSED_STATES,
    defaultFailure: ScraperErrorTypes.Generic,
  },
};

/** Asks the bank to text the code; the masked phone reaches the retriever. */
const OTP_INIT_STEP: IStepConfig = {
  name: 'otpInit',
  urlTag: 'auth.otpInit',
  encoding: 'form-utf8',
  body: { shape: OTP_INIT_FORM },
  headers: AUTH_HEADERS,
  runIf: OTP_PENDING,
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { phone: '/result/phone' },
  optionalExtractsToCarry: { initState: { pointer: '/state' } },
  extractRules: {
    phone: { type: 'string', pattern: '^.{1,64}$' },
    initState: { type: 'string', transform: 'lower', oneOf: ['logonotp'] },
  },
};

/** Sends the code; success is the landing state. */
const OTP_VERIFY_STEP: IStepConfig = {
  name: 'otpVerify',
  urlTag: 'auth.otpVerify',
  encoding: 'form-utf8',
  body: { shape: OTP_VERIFY_FORM },
  headers: AUTH_HEADERS,
  runIf: OTP_PENDING,
  failIfPresent: HAPOALIM_ERRORS,
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otp',
    hintFrom: 'carry.phone',
    requires: ['cookie.csrfcookie', 'carry.flow'],
    valuePattern: String.raw`^\d{5}$`,
  },
  extractsToCarry: {},
  optionalExtractsToCarry: { target: { pointer: '/target' } },
  extractRules: { target: TARGET_RULE },
  outcome: {
    codePointer: '/state',
    caseInsensitive: true,
    successCodes: ['landpage'],
    failureMap: REFUSED_STATES,
    defaultFailure: ScraperErrorTypes.InvalidOtp,
  },
};

/** Registers the device on the app edge; a valid warm session lands here. */
const STEP1_STEP: IStepConfig = {
  name: 'step1',
  urlTag: 'auth.step1',
  method: 'GET',
  response: 'text',
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: {},
};

/** The login steps in order; `step1` is the warm-start resume point. */
const HAPOALIM_STEPS: readonly IStepConfig[] = [
  IDENTIFY_STEP,
  VERIFY_STEP,
  OTP_INIT_STEP,
  OTP_VERIFY_STEP,
  STEP1_STEP,
  ...HAPOALIM_DEVICE_STEPS,
];

/** Where a warm start resumes: the device registration call, which checks the session. */
const HAPOALIM_RESUME_STEP_INDEX = HAPOALIM_STEPS.indexOf(STEP1_STEP);

export default HAPOALIM_STEPS;
export { HAPOALIM_RESUME_STEP_INDEX, HAPOALIM_STEPS };
