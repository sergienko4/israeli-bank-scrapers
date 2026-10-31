/**
 * Hapoalim login steps: load the login page, read the RSA key, identify the
 * user, verify the sealed password, run the SMS OTP when asked, and land on
 * the portal. Each step refuses any reply that names an error.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IStepConfig,
  IStepOutcome,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  HAPOALIM_DOCUMENT_HEADERS,
  HAPOALIM_ERRORS,
  HAPOALIM_POST_HEADERS,
  HAPOALIM_SEAL_PARAMS,
  HAPOALIM_TARGETS,
} from './PipelineBankConfigHapoalimConstants.js';
import {
  IDENTIFY_FORM,
  OTP_INIT_FORM,
  OTP_VERIFY_FORM,
  VERIFY_FORM,
} from './PipelineBankConfigHapoalimForms.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const DOCUMENT_HEADERS = literalHeaders(HAPOALIM_DOCUMENT_HEADERS);
const POST_HEADERS = literalHeaders(HAPOALIM_POST_HEADERS);

/** The states that refuse the login, whatever their case. */
const REFUSED_STATES: IStepOutcome['failureMap'] = {
  locked: ScraperErrorTypes.AccountBlocked,
  disabled: ScraperErrorTypes.AccountBlocked,
  reissue: ScraperErrorTypes.ChangePassword,
};

/** The OTP steps run only when the password step asked for one. */
const OTP_PENDING = { carry: 'state', oneOf: ['logonotp'] } as const;

/** A portal page the bank points at, checked against the known targets. */
const TARGET_RULE = { url: HAPOALIM_TARGETS } as const;

const BOOTSTRAP_STEP: IStepConfig = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  method: 'GET',
  response: 'document',
  documentMarker: 'bnhpApp.ngContext',
  headers: DOCUMENT_HEADERS,
  extractsToCarry: {},
};

const ENCRYPTION_KEY_STEP: IStepConfig = {
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  method: 'GET',
  extractsToCarry: { modulus: '/encryptionKey' },
  extractRules: { modulus: { type: 'string', pattern: '^[0-9a-fA-F]+$' } },
  deriveCarry: [
    {
      into: 'g3cme',
      parts: ['config.secrets.wrapPrefix', 'carry.modulus', 'config.secrets.wrapSuffix'],
    },
  ],
};

const IDENTIFY_STEP: IStepConfig = {
  name: 'identify',
  urlTag: 'auth.identify',
  encoding: 'form',
  body: { shape: IDENTIFY_FORM },
  headers: POST_HEADERS,
  setCookies: { G3CmE: 'carry.g3cme' },
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { result: '/result' },
  extractRules: { result: { type: 'object' } },
};

const VERIFY_STEP: IStepConfig = {
  name: 'verify',
  urlTag: 'auth.verify',
  encoding: 'form',
  body: { shape: VERIFY_FORM },
  headers: POST_HEADERS,
  seal: {
    kind: 'rsa-pkcs1-block-xor',
    sourceRef: 'creds.password',
    modulusRef: 'carry.modulus',
    writeTo: '/credentials',
    params: HAPOALIM_SEAL_PARAMS,
  },
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { state: '/state' },
  optionalExtractsToCarry: { flow: { pointer: '/flow' }, target: { pointer: '/target' } },
  extractRules: {
    state: { transform: 'lower' },
    flow: { transform: 'lower', oneOf: ['authenticate'] },
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

const OTP_INIT_STEP: IStepConfig = {
  name: 'otpInit',
  urlTag: 'auth.otpInit',
  encoding: 'form',
  body: { shape: OTP_INIT_FORM },
  headers: POST_HEADERS,
  runIf: OTP_PENDING,
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { phone: '/result/phone' },
  optionalExtractsToCarry: { initState: { pointer: '/state' } },
  extractRules: {
    phone: { type: 'string', pattern: '^.{1,64}$' },
    initState: { type: 'string', transform: 'lower', oneOf: ['logonotp'] },
  },
};

const OTP_VERIFY_STEP: IStepConfig = {
  name: 'otpVerify',
  urlTag: 'auth.otpVerify',
  encoding: 'form',
  body: { shape: OTP_VERIFY_FORM },
  headers: POST_HEADERS,
  runIf: OTP_PENDING,
  failIfPresent: HAPOALIM_ERRORS,
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otp',
    hintFrom: 'carry.phone',
    requires: ['cookie.csrfcookie', 'carry.flow'],
    valuePattern: '^\\d{5}$',
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

const LANDING_STEP: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  failIfPresent: HAPOALIM_ERRORS,
  extractsToCarry: { pageId: '/pageId' },
  extractRules: { pageId: { pattern: '^\\d{1,4}$' } },
};

/** The login steps in order; the landing step is the warm-start resume point. */
const HAPOALIM_STEPS: readonly IStepConfig[] = [
  BOOTSTRAP_STEP,
  ENCRYPTION_KEY_STEP,
  IDENTIFY_STEP,
  VERIFY_STEP,
  OTP_INIT_STEP,
  OTP_VERIFY_STEP,
  LANDING_STEP,
];

export default HAPOALIM_STEPS;
export { HAPOALIM_STEPS };
