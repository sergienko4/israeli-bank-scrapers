/**
 * FIBI-family answer classifiers, read the way the Transmit web SDK
 * reads its control flow: the login answer must offer exactly the password
 * method; the password answer either completes with a token or offers one
 * SMS target, its code numeric and 4..10 digits or of no stated format; the
 * OTP calls must keep that format. Any other shape fails closed. Pure data
 * (Rule #11).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IAnswerCapture,
  IAnswerCase,
  IAnswerCheck,
  IAnswerClassifier,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The one method of the one pending action. */
const METHOD = '/data/control_flow/0/methods/0';
const METHOD_TYPE = `${METHOD}/type`;
const METHOD_ID = `${METHOD}/assertion_id`;
const CHALLENGE = '/data/challenge';
const STATE = '/data/state';
const SMS = `${METHOD}/channels/?type=sms`;
const SMS_ID = `${SMS}/assertion_id`;
const SMS_TARGETS = `${SMS}/targets`;

/** The SDK reads `format`, else `otp_format` — one whole object, never a mix. */
const FORMAT = [`${METHOD}/format`, `${METHOD}/otp_format`];

/** A trigger answer's updated format. */
const TRIGGER_FORMAT = '/data/data/otp_format';

const OTP_LENGTHS = [4, 5, 6, 7, 8, 9, 10];
const LENGTH_RANGE = { min: 4, max: 10 };
const PENDING: IAnswerCheck = { pointer: STATE, equals: 'pending' };
const NOT_LOCKED: IAnswerCheck = { pointer: `${METHOD}/locked`, equals: false };
const NOT_EXPIRED: IAnswerCheck = { pointer: `${METHOD}/expired`, equals: false };

/** One pending authentication action offering exactly one method. */
const ONE_METHOD: readonly IAnswerCheck[] = [
  PENDING,
  { pointer: '/data/control_flow', items: 1 },
  { pointer: '/data/control_flow/0/type', equals: 'authentication' },
  { pointer: '/data/control_flow/0/methods', items: 1 },
];

const PASSWORD: readonly IAnswerCheck[] = [
  ...ONE_METHOD,
  { pointer: METHOD_TYPE, equals: 'password' },
];

/** The SMS channel alone, with one target: the SDK submits the code to target 0. */
const OTP_OFFER: readonly IAnswerCheck[] = [
  ...ONE_METHOD,
  { pointer: METHOD_TYPE, equals: 'otp' },
  NOT_LOCKED,
  NOT_EXPIRED,
  { pointer: `${METHOD}/channels`, items: 1 },
  { pointer: SMS_ID, text: { maxChars: 2048 } },
  { pointer: SMS_TARGETS, keys: 1 },
];

const OTP_TARGET: Readonly<Record<string, IAnswerCapture>> = {
  otpAssertionId: { pointer: SMS_ID, maxChars: 2048 },
  otpTargetId: { pointer: SMS_TARGETS, onlyKey: true, maxChars: 256 },
};

const DONE: IAnswerCase = {
  name: 'done',
  when: [
    { pointer: STATE, equals: 'completed' },
    { pointer: '/data/assertions_complete', equals: true },
    { pointer: '/data/token', text: { maxChars: 32768, pattern: String.raw`^[^\x00-\x20]+$` } },
  ],
};

/** Whether the SMS code is yet to be sent, or already was. */
type OtpState = 'generate' | 'validate';

/** The object the SDK reads the code format from. */
type FormatRoot = 'format' | 'otp_format';

/** `otp_format` counts only when `format` is not there at all. */
const ROOT_GUARD: Readonly<Record<FormatRoot, readonly IAnswerCheck[]>> = {
  format: [],
  otp_format: [{ pointer: `${METHOD}/format`, absent: true }],
};

/**
 * The OTP offer in one state, its format unstated.
 * @param state - The method's state.
 * @returns The case.
 */
function unformattedOtp(state: OtpState): IAnswerCase {
  const when = [
    ...OTP_OFFER,
    { pointer: `${METHOD}/state`, equals: state },
    { pointer: FORMAT, absent: true as const },
  ];
  return { name: `otp-${state}`, when, captures: OTP_TARGET };
}

/**
 * Checks that a format object declares a numeric code of an allowed length.
 * @param prefix - JSON pointer to the format object.
 * @returns Type and length checks for that format object.
 */
function numericFormatChecks(prefix: string): readonly IAnswerCheck[] {
  return [
    { pointer: `${prefix}/type`, equals: 'numeric' },
    { pointer: `${prefix}/length`, oneOf: OTP_LENGTHS },
  ];
}

/**
 * Bounded integer capture for `otpLength` under a format object.
 * @param prefix - JSON pointer to the format object.
 * @returns Capture rule for `otpLength`.
 */
function otpLengthCapture(prefix: string): IAnswerCapture {
  return { pointer: `${prefix}/length`, maxChars: 2, integer: LENGTH_RANGE };
}

/**
 * The OTP offer in one state, its code numeric of a length stated under
 * one format object — type and length both read from that object.
 * @param state - The method's state.
 * @param root - The format object the SDK reads.
 * @returns The case.
 */
function numericOtp(state: OtpState, root: FormatRoot): IAnswerCase {
  const prefix = `${METHOD}/${root}`;
  const stateCheck: IAnswerCheck = { pointer: `${METHOD}/state`, equals: state };
  const when = [...OTP_OFFER, stateCheck, ...ROOT_GUARD[root], ...numericFormatChecks(prefix)];
  const otpLength = otpLengthCapture(prefix);
  return { name: `otp-${state}`, when, captures: { ...OTP_TARGET, otpLength } };
}

const FIBI_LOGIN_CLASSIFIER: IAnswerClassifier = {
  into: 'loginBranch',
  cases: [
    {
      name: 'password',
      when: [
        ...PASSWORD,
        NOT_LOCKED,
        NOT_EXPIRED,
        { pointer: CHALLENGE, text: { maxChars: 16384 } },
        { pointer: METHOD_ID, text: { maxChars: 2048 } },
      ],
      captures: {
        pwdAssertionId: { pointer: METHOD_ID, maxChars: 2048 },
        challenge: { pointer: CHALLENGE, maxChars: 16384 },
      },
    },
    {
      name: 'locked',
      when: [...PASSWORD, { pointer: `${METHOD}/locked`, equals: true }],
      fail: ScraperErrorTypes.AccountBlocked,
    },
    {
      name: 'expired',
      when: [...PASSWORD, NOT_LOCKED, { pointer: `${METHOD}/expired`, equals: true }],
      fail: ScraperErrorTypes.ChangePassword,
    },
  ],
};

const FIBI_AUTH_CLASSIFIER: IAnswerClassifier = {
  into: 'authBranch',
  cases: [
    DONE,
    numericOtp('generate', 'format'),
    numericOtp('generate', 'otp_format'),
    unformattedOtp('generate'),
    numericOtp('validate', 'format'),
    numericOtp('validate', 'otp_format'),
    unformattedOtp('validate'),
  ],
};

const FIBI_OTP_TRIGGER_CLASSIFIER: IAnswerClassifier = {
  into: 'otpTrigger',
  cases: [
    { name: 'pending', when: [PENDING, { pointer: TRIGGER_FORMAT, absent: true }] },
    {
      name: 'pending',
      when: [PENDING, ...numericFormatChecks(TRIGGER_FORMAT)],
      captures: { otpLength: otpLengthCapture(TRIGGER_FORMAT) },
    },
  ],
};

const FIBI_OTP_RESULT_CLASSIFIER: IAnswerClassifier = { into: 'otpResult', cases: [DONE] };

export {
  FIBI_AUTH_CLASSIFIER,
  FIBI_LOGIN_CLASSIFIER,
  FIBI_OTP_RESULT_CLASSIFIER,
  FIBI_OTP_TRIGGER_CLASSIFIER,
};
