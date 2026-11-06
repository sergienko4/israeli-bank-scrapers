/**
 * N50 build rules — an answer classifier must be well formed: cases each with
 * a check, one kind per check, JSON pointers, anchored flat patterns, length
 * caps, one capture mode and an integer range. Its slots must not be its own
 * capture, another slot its step writes or a `sessionCarry` slot, and a
 * `runIf` guard on its slot may list only its case names.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IAnswerCapture,
  IAnswerCase,
  IAnswerCheck,
  IAnswerClassifier,
  IApiDirectCallConfig,
  IGetStep,
  IPostStep,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://ref.example';
const NATIVE = {
  identityBase: HOST,
  graphql: `${HOST}/graphql`,
  paths: {},
  nativeFetch: true,
  redirectPolicy: 'reject' as const,
};

const NEEDS_CASES = 'steps.classify: needs cases, each with a check';
const ONE_KIND = 'steps.classify: each check names exactly one kind';
const POINTER = 'steps.classify: each pointer must be a JSON pointer';
const ANCHORED = 'steps.classify.text.pattern: must be an anchored regex';
const FLAT = 'steps.classify.text.pattern: must be a flat regex';
const CAP = 'steps.classify.maxChars: must be an integer from 1 to 65536';
const ONE_MODE = 'steps.classify.captures: onlyKey and integer are exclusive';
const RANGE = 'steps.classify.captures.integer: must be an integer range';
const INTO_CAPTURE = 'steps.classify.captures: a slot must not be into';
const EXTRACT = 'steps.classify: slots must not be slots the step also writes';
const SESSION = 'steps.classify.into: must not be a sessionCarry slot';
const GUARD = 'steps.runIf: on a classifier slot, oneOf lists only case names';

const PENDING: IAnswerCheck = { pointer: '/state', equals: 'pending' };
const DONE: IAnswerCase = { name: 'done', when: [{ pointer: '/state', equals: 'ok' }] };
const OTP_ID: IAnswerCapture = { pointer: ['/id', '/data/id'], maxChars: 32 };
const OTP: IAnswerCase = { name: 'otp', when: [PENDING], captures: { otpId: OTP_ID } };
const CLASSIFIER: IAnswerClassifier = { into: 'branch', cases: [DONE, OTP] };

/**
 * A login step that classifies its answer.
 * @param classify - Answer classifier.
 * @returns POST step.
 */
function loginWith(classify: IAnswerClassifier): IPostStep {
  return {
    name: 'login',
    urlTag: 'auth.login',
    body: { shape: {} },
    extractsToCarry: {},
    classify,
  };
}

/**
 * A step guarded on a carry slot.
 * @param carry - Guarded slot.
 * @param oneOf - Texts that let it run.
 * @returns POST step.
 */
function guardedOn(carry: string, oneOf: readonly string[]): IPostStep {
  const runIf = { carry, oneOf };
  return {
    name: 'assertOtp',
    urlTag: 'auth.bind',
    body: { shape: {} },
    extractsToCarry: {},
    runIf,
  };
}

/**
 * A login step whose `otp` case holds one check.
 * @param check - The check.
 * @returns POST step.
 */
function checkStep(check: IAnswerCheck): IPostStep {
  return loginWith({ into: 'branch', cases: [DONE, { name: 'otp', when: [check] }] });
}

/**
 * A login step whose `otp` case captures one slot.
 * @param capture - The capture.
 * @returns POST step.
 */
function captureStep(capture: IAnswerCapture): IPostStep {
  return loginWith({ into: 'branch', cases: [DONE, { ...OTP, captures: { otpId: capture } }] });
}

/**
 * A login step whose `otp` case holds one text check.
 * @param pattern - Text pattern.
 * @returns POST step.
 */
function patternStep(pattern: string): IPostStep {
  return checkStep({ pointer: '/t', text: { maxChars: 9, pattern } });
}

/** One build: its login steps, resume steps and session slots. */
interface IBuildCase {
  readonly label: string;
  readonly steps: readonly IStepConfig[];
  readonly resume?: readonly IStepConfig[];
  readonly sessionCarry?: readonly string[];
}

/** A build the rules refuse, and the message they refuse it with. */
interface IRefusal extends IBuildCase {
  readonly message: string;
}

/**
 * Rule input for a build case.
 * @param build - Steps, resume steps and session slots.
 * @returns Rule input over a native headless block.
 */
function inputOf(build: IBuildCase): IApiDirectRuleInput {
  const { steps, sessionCarry } = build;
  const call: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps, sessionCarry };
  if (build.resume === undefined) return { call, headless: NATIVE };
  const persistentAuth = {
    kind: 'bound-device' as const,
    provider: 'syn-provider',
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'account',
    freshnessMarginSeconds: 60,
    resumeSteps: build.resume,
  };
  return { call: { ...call, persistentAuth }, headless: NATIVE };
}

const LOGIN = loginWith(CLASSIFIER);
const TEXT_CAPTURE = { pattern: 'k=(\\w+)', group: 1 };

const SHAPE_REFUSALS: readonly IRefusal[] = [
  { label: 'no case', steps: [loginWith({ into: 'b', cases: [] })], message: NEEDS_CASES },
  {
    label: 'a case of no check',
    steps: [loginWith({ into: 'branch', cases: [DONE, { name: 'otp', when: [] }] })],
    message: NEEDS_CASES,
  },
  {
    label: 'a resume step of no case',
    steps: [LOGIN],
    resume: [loginWith({ into: 'b', cases: [] })],
    message: NEEDS_CASES,
  },
  { label: 'a check of no kind', steps: [checkStep({ pointer: '/s' })], message: ONE_KIND },
  {
    label: 'a check of two kinds',
    steps: [checkStep({ pointer: '/s', equals: 'a', oneOf: ['a'] })],
    message: ONE_KIND,
  },
  {
    label: 'absent beside a value kind',
    steps: [checkStep({ pointer: '/s', absent: true, items: 1 })],
    message: ONE_KIND,
  },
  {
    label: 'no pointer alternative',
    steps: [checkStep({ pointer: [], equals: 'a' })],
    message: POINTER,
  },
  {
    label: 'a bare key',
    steps: [checkStep({ pointer: 'state', absent: true })],
    message: POINTER,
  },
  {
    label: 'a bare key alternative',
    steps: [checkStep({ pointer: ['/a', 'b'], equals: 'x' })],
    message: POINTER,
  },
  {
    label: 'a capture of no alternative',
    steps: [captureStep({ pointer: [], maxChars: 4 })],
    message: POINTER,
  },
  { label: 'an unanchored pattern', steps: [patternStep('[a-z]+')], message: ANCHORED },
  { label: 'a pattern that does not compile', steps: [patternStep('^[z-a]$')], message: ANCHORED },
  {
    label: 'a pattern that compiles only inside the whole-match wrapper',
    steps: [patternStep('^a)|(?:b$')],
    message: ANCHORED,
  },
  { label: 'a pattern with a group', steps: [patternStep('^(a+)+$')], message: FLAT },
  { label: 'a pattern of two variable repeats', steps: [patternStep('^a+b+$')], message: FLAT },
  {
    label: 'a text cap of zero',
    steps: [checkStep({ pointer: '/t', text: { maxChars: 0 } })],
    message: CAP,
  },
  {
    label: 'a fractional text cap',
    steps: [checkStep({ pointer: '/t', text: { maxChars: 1.5 } })],
    message: CAP,
  },
  {
    label: 'a capture cap over 65536',
    steps: [captureStep({ pointer: '/v', maxChars: 65537 })],
    message: CAP,
  },
  {
    label: 'a capture of both modes',
    steps: [
      captureStep({ pointer: '/v', maxChars: 4, onlyKey: true, integer: { min: 1, max: 2 } }),
    ],
    message: ONE_MODE,
  },
  {
    label: 'an integer range upside down',
    steps: [captureStep({ pointer: '/v', maxChars: 4, integer: { min: 5, max: 4 } })],
    message: RANGE,
  },
  {
    label: 'a fractional integer bound',
    steps: [captureStep({ pointer: '/v', maxChars: 4, integer: { min: 0.5, max: 4 } })],
    message: RANGE,
  },
  {
    label: 'an unsafe integer lower bound',
    steps: [
      captureStep({
        pointer: '/v',
        maxChars: 20,
        integer: { min: Number.MIN_SAFE_INTEGER - 1, max: 4 },
      }),
    ],
    message: RANGE,
  },
  {
    label: 'an unsafe integer upper bound',
    steps: [
      captureStep({
        pointer: '/v',
        maxChars: 20,
        integer: { min: 0, max: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ],
    message: RANGE,
  },
];

const SLOT_REFUSALS: readonly IRefusal[] = [
  {
    label: 'a capture into the case slot',
    steps: [loginWith({ into: 'branch', cases: [DONE, { ...OTP, captures: { branch: OTP_ID } }] })],
    message: INTO_CAPTURE,
  },
  {
    label: 'the case slot as a body extract',
    steps: [{ ...LOGIN, extractsToCarry: { branch: '/b' } }],
    message: EXTRACT,
  },
  {
    label: 'a capture slot as an optional extract',
    steps: [{ ...LOGIN, optionalExtractsToCarry: { otpId: { pointer: '/o' } } }],
    message: EXTRACT,
  },
  {
    label: 'a capture slot as a header extract',
    steps: [{ ...LOGIN, headerExtractsToCarry: { otpId: { header: 'x-otp' } } }],
    message: EXTRACT,
  },
  {
    label: 'the case slot as a derived slot',
    steps: [{ ...LOGIN, deriveCarry: [{ into: 'branch', parts: ['creds.nextBranch'] }] }],
    message: EXTRACT,
  },
  {
    label: 'a capture slot as a derived slot',
    steps: [{ ...LOGIN, deriveCarry: [{ into: 'otpId', parts: ['creds.otpId'] }] }],
    message: EXTRACT,
  },
  {
    label: 'the case slot as a text capture',
    steps: [{ ...LOGIN, response: 'text', textCaptures: { branch: TEXT_CAPTURE } }],
    message: EXTRACT,
  },
  {
    label: 'the case slot as a final URL',
    steps: [
      {
        name: 'bootstrap',
        urlTag: 'auth.bind',
        method: 'GET',
        extractsToCarry: {},
        finalUrlInto: 'branch',
        redirect: { maxHops: 2, allow: [{ origin: HOST, paths: ['/landing'] }] },
        classify: CLASSIFIER,
      } satisfies IGetStep,
    ],
    message: EXTRACT,
  },
  {
    label: 'a capture slot as a form capture',
    steps: [
      {
        ...LOGIN,
        response: 'text',
        formCapture: {
          form: 'loginForm',
          into: 'otpId',
          action: `${HOST}/login`,
          required: ['user'],
          forbidden: [],
          minFields: 1,
          maxFields: 3,
        },
      },
    ],
    message: EXTRACT,
  },
  {
    label: 'the case slot as a handoff capture',
    steps: [
      {
        ...LOGIN,
        response: 'text',
        locationCapture: {
          into: 'branch',
          userAgent: 'synthetic-user-agent',
          url: [{ origin: HOST, anyPathExcept: ['logout'] }],
        },
      },
    ],
    message: EXTRACT,
  },
  {
    label: 'the case slot kept for the scrape',
    steps: [LOGIN],
    sessionCarry: ['branch'],
    message: SESSION,
  },
  {
    label: 'a guard on a name no case has',
    steps: [LOGIN, guardedOn('branch', ['otp', 'typo'])],
    message: GUARD,
  },
];

const ACCEPTED: readonly IBuildCase[] = [
  { label: 'a classifier and its guard', steps: [LOGIN, guardedOn('branch', ['otp'])] },
  {
    label: 'a classifier deriving a different slot',
    steps: [{ ...LOGIN, deriveCarry: [{ into: 'nextBranch', parts: ['carry.branch'] }] }],
  },
  {
    label: 'repeated case names',
    steps: [
      loginWith({
        ...CLASSIFIER,
        cases: [DONE, OTP, { ...OTP, when: [{ pointer: '/otp', keys: 1 }] }],
      }),
    ],
  },
  { label: 'equals null as the one kind', steps: [checkStep({ pointer: '/x', equals: null })] },
  { label: 'a flat anchored pattern', steps: [patternStep('^[a-z]{2}\\d*$')] },
  {
    label: 'an onlyKey capture',
    steps: [captureStep({ pointer: '/v', maxChars: 64, onlyKey: true })],
  },
  {
    label: 'an integer capture',
    steps: [captureStep({ pointer: '/v', maxChars: 2, integer: { min: 4, max: 10 } })],
  },
  { label: 'a guard on a slot no classifier writes', steps: [LOGIN, guardedOn('other', ['x'])] },
  {
    label: 'a guard on the names of two classifiers of one slot',
    steps: [
      LOGIN,
      {
        ...guardedOn('branch', ['otp']),
        classify: { into: 'branch', cases: [{ ...DONE, name: 'retry' }] },
      },
      { ...guardedOn('branch', ['otp', 'retry']), name: 'validate' },
    ],
  },
  {
    label: 'the case slot extracted by another step',
    steps: [LOGIN, { ...guardedOn('branch', ['otp']), extractsToCarry: { branch: '/b' } }],
  },
  { label: 'a step with no classifier', steps: [guardedOn('branch', ['otp'])] },
];

describe('validateApiDirectConfig — N50 classifier rules', () => {
  it.each([...SHAPE_REFUSALS, ...SLOT_REFUSALS])('refuses $label', refusal => {
    const input = inputOf(refusal);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: refusal.message,
    });
  });

  it.each(ACCEPTED)('builds $label', build => {
    const input = inputOf(build);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
