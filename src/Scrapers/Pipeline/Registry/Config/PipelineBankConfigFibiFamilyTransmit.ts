/**
 * FIBI-family Transmit steps (spec §11.2 rows 2–4b): the key exchange, the
 * sealed login and the password and SMS-code assertions. Each names the
 * brand's app and, once the bank named them, its device and session; each
 * checks the device and session ids the bank names before they are kept.
 * Pure data (Rule #11).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IExtractRule,
  IOptionalExtract,
  IPostStep,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  FIBI_KEY_EXCHANGE_BODY,
  FIBI_LOGIN_BODY,
  FIBI_OTP_BODY,
  FIBI_OTP_TRIGGER_BODY,
  FIBI_PASSWORD_BODY,
} from './PipelineBankConfigFibiFamilyBodies.js';
import {
  FIBI_AUTH_CLASSIFIER,
  FIBI_LOGIN_CLASSIFIER,
  FIBI_OTP_RESULT_CLASSIFIER,
  FIBI_OTP_TRIGGER_CLASSIFIER,
} from './PipelineBankConfigFibiFamilyClassify.js';
import {
  FIBI_TS_AUTHORIZATION,
  FIBI_TS_CLIENT_VERSION,
  FIBI_UA,
  fibiEntryUrl,
  type IFibiBrand,
} from './PipelineBankConfigFibiFamilyConstants.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

/** The brand-specific part of a Transmit step. */
type BrandPart = Pick<IPostStep, 'headers' | 'queryTemplate' | 'extractRules'>;

/** The brand-independent part of a Transmit step. */
type StepPart = Omit<IPostStep, keyof BrandPart>;

const JSON_TYPE = 'application/json';
const TOKEN = '/data/token';

/** A device id the bank named is kept over a later answer's. */
const DID: IOptionalExtract = { pointer: '/headers/?type=device_id/device_id', keepExisting: true };
const SID_POINTER = '/headers/?type=session_id/session_id';
const SESSION_EXTRACTS = { did: DID, sid: { pointer: SID_POINTER } };
const SESSION_RULES: Readonly<Record<string, IExtractRule>> = {
  did: { pattern: String.raw`^[\w.:-]+$`, maxChars: 256 },
  sid: { pattern: String.raw`^[\x21-\x7e]+$`, maxChars: 2048 },
};

const SEALED = {
  kind: 'ecdh-aes-cbc',
  mode: 'sealed',
  keyRef: 'carry.envelopeKey',
  sessionRef: 'carry.envelopeSession',
} as const;

const ENCRYPTION_KEY: StepPart = {
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  extractsToCarry: {},
  optionalExtractsToCarry: SESSION_EXTRACTS,
  body: FIBI_KEY_EXCHANGE_BODY,
  codec: {
    kind: 'ecdh-aes-cbc',
    mode: 'exchange',
    privateRef: 'carry.ecdhPrivate',
    keyInto: 'envelopeKey',
    sessionInto: 'envelopeSession',
  },
};

/** The login answer opens the session, so its session id is required. */
const LOGIN: StepPart = {
  name: 'login',
  urlTag: 'auth.login',
  extractsToCarry: { sid: SID_POINTER },
  optionalExtractsToCarry: { did: DID },
  body: FIBI_LOGIN_BODY,
  codec: SEALED,
  classify: FIBI_LOGIN_CLASSIFIER,
};

/** What every assertion shares: the session, the seal and the error refusal. */
const ASSERTION = {
  urlTag: 'auth.assert',
  codec: SEALED,
  failIfPresent: ['/data/assertion_error_code'],
  optionalExtractsToCarry: SESSION_EXTRACTS,
} as const;

const ASSERT_PASSWORD: StepPart = {
  ...ASSERTION,
  name: 'assertPassword',
  extractsToCarry: {},
  optionalExtractsToCarry: { ...SESSION_EXTRACTS, token: { pointer: TOKEN } },
  body: FIBI_PASSWORD_BODY,
  bankErrorType: ScraperErrorTypes.InvalidPassword,
  classify: FIBI_AUTH_CLASSIFIER,
};

const OTP_INIT: StepPart = {
  ...ASSERTION,
  name: 'otpInit',
  extractsToCarry: {},
  body: FIBI_OTP_TRIGGER_BODY,
  bankErrorType: ScraperErrorTypes.Generic,
  classify: FIBI_OTP_TRIGGER_CLASSIFIER,
  runIf: { carry: 'authBranch', oneOf: ['otp-generate'] },
};

/** The typed code must have the length the bank last stated, if it stated one. */
const ASSERT_OTP: StepPart = {
  ...ASSERTION,
  name: 'assertOtp',
  extractsToCarry: { token: TOKEN },
  body: FIBI_OTP_BODY,
  bankErrorType: ScraperErrorTypes.InvalidOtp,
  classify: FIBI_OTP_RESULT_CLASSIFIER,
  runIf: { carry: 'authBranch', oneOf: ['otp-generate', 'otp-validate'] },
  preHook: {
    awaitCredsField: 'otpCodeRetriever',
    intoCarryField: 'otpCode',
    valuePattern: '^[0-9]{4,10}$',
    valueLengthRef: 'carry.otpLength',
  },
};

/**
 * The SDK's fixed headers, sent from the brand's entry page.
 * @param brand - FIBI-family brand.
 * @returns Header templates.
 */
function transmitHeaders(brand: IFibiBrand): IPostStep['headers'] {
  const referer = fibiEntryUrl(brand);
  const sdk = {
    'x-ts-client-version': FIBI_TS_CLIENT_VERSION,
    authorization: FIBI_TS_AUTHORIZATION,
  };
  const caller = { 'user-agent': FIBI_UA, origin: brand.origin, referer };
  return literalHeaders({ 'content-type': JSON_TYPE, accept: JSON_TYPE, ...sdk, ...caller });
}

/**
 * Rows 2–3: before a session, the app id and the device once known.
 * @param brand - FIBI-family brand.
 * @returns The key-exchange and login steps.
 */
function fibiOpeningSteps(brand: IFibiBrand): readonly IPostStep[] {
  const did = { $ref: 'carry.did', optional: true } as const;
  const queryTemplate = { aid: { $literal: brand.aid }, did };
  const part = { headers: transmitHeaders(brand), queryTemplate, extractRules: SESSION_RULES };
  return [ENCRYPTION_KEY, LOGIN].map(step => ({ ...step, ...part }));
}

/**
 * Rows 4–4b: within the session, the app, device and session ids.
 * @param brand - FIBI-family brand.
 * @returns The password, code-trigger and code steps.
 */
function fibiAssertSteps(brand: IFibiBrand): readonly IPostStep[] {
  const ids = { did: { $ref: 'carry.did' }, sid: { $ref: 'carry.sid' } } as const;
  const queryTemplate = { aid: { $literal: brand.aid }, ...ids };
  const part = { headers: transmitHeaders(brand), queryTemplate, extractRules: SESSION_RULES };
  return [ASSERT_PASSWORD, OTP_INIT, ASSERT_OTP].map(step => ({ ...step, ...part }));
}

export { fibiAssertSteps, fibiOpeningSteps };
