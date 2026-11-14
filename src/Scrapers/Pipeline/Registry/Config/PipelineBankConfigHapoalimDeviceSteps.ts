/**
 * Hapoalim new-device registration steps: the Arcot download, the device
 * step-up SMS and the Arcot id retry. They run only when `verify` reported
 * a new device, so a registered device never prompts twice.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { HAPOALIM_ERRORS } from './PipelineBankConfigHapoalimConstants.js';
import {
  ARCOTID_FORM,
  STEPUP_INIT_FORM,
  STEPUP_VERIFY_FORM,
} from './PipelineBankConfigHapoalimForms.js';
import {
  AUTH_HEADERS,
  NEW_DEVICE,
  REFUSED_STATES,
} from './PipelineBankConfigHapoalimStepShared.js';

/** Starts the Arcot download; a new device answers 302 to the step-up. */
const ARCOTID_STEP: IStepConfig = {
  name: 'arcotid',
  urlTag: 'auth.arcotid',
  encoding: 'form-utf8',
  body: { shape: ARCOTID_FORM },
  headers: AUTH_HEADERS,
  runIf: NEW_DEVICE,
  redirect: 'accept',
  response: 'text',
  maxTextChars: 8192,
  extractsToCarry: {},
};

/** Sends the device step-up SMS. */
const STEPUP_INIT_STEP: IStepConfig = {
  name: 'stepupInit',
  urlTag: 'auth.stepupInit',
  encoding: 'form-utf8',
  body: { shape: STEPUP_INIT_FORM },
  headers: AUTH_HEADERS,
  runIf: NEW_DEVICE,
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { stepupPhone: '/result/phone' },
  extractRules: { stepupPhone: { type: 'string', pattern: '^.{1,64}$' } },
};

/** Sends the device step-up code; success is `FINISH`. */
const STEPUP_VERIFY_STEP: IStepConfig = {
  name: 'stepupVerify',
  urlTag: 'auth.stepupVerify',
  encoding: 'form-utf8',
  body: { shape: STEPUP_VERIFY_FORM },
  headers: AUTH_HEADERS,
  runIf: NEW_DEVICE,
  failIfPresent: HAPOALIM_ERRORS,
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'stepupOtp',
    hintFrom: 'carry.stepupPhone',
    reuse: 'per-step',
    valuePattern: String.raw`^\d{5}$`,
  },
  extractsToCarry: {},
  outcome: {
    codePointer: '/state',
    caseInsensitive: true,
    successCodes: ['finish'],
    failureMap: REFUSED_STATES,
    defaultFailure: ScraperErrorTypes.InvalidOtp,
  },
};

/** Downloads the Arcot id once the device is validated. */
const ARCOTID_AFTER_STEP: IStepConfig = {
  name: 'arcotidAfter',
  urlTag: 'auth.arcotidAfter',
  encoding: 'form-utf8',
  body: { shape: ARCOTID_FORM },
  headers: AUTH_HEADERS,
  runIf: NEW_DEVICE,
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: {},
  outcome: {
    codePointer: '/state',
    caseInsensitive: true,
    successCodes: ['finish'],
    failureMap: REFUSED_STATES,
    defaultFailure: ScraperErrorTypes.Generic,
  },
};

const HAPOALIM_DEVICE_STEPS: readonly IStepConfig[] = [
  ARCOTID_STEP,
  STEPUP_INIT_STEP,
  STEPUP_VERIFY_STEP,
  ARCOTID_AFTER_STEP,
];

export default HAPOALIM_DEVICE_STEPS;
export { HAPOALIM_DEVICE_STEPS };
