/**
 * N40/N41/N51/N54 build rules — a raw query replaces the query template, never
 * joins it; a carried step URL (a GET's, by type) reads a slot that an earlier
 * step in the same list checked, with an `extractRules` `url` rule, as its
 * `finalUrlInto` slot or as its `locationCapture` slot. A `finalUrlInto` needs the step's own manual redirect,
 * whose `allow` rules check the URL, and a slot the step extracts nothing into.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IJoinTemplate,
  IPostStep,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://url.example';
/** A native headless block; a step's manual redirect needs the bank to reject the rest. */
const NATIVE = {
  identityBase: HOST,
  graphql: `${HOST}/graphql`,
  paths: {},
  nativeFetch: true,
  redirectPolicy: 'reject' as const,
};
const RAW_MSG = 'steps.rawQuery: not with queryTemplate';
const RULE_MSG = 'steps.urlFromCarry: slot needs an earlier url rule';
const MANUAL_MSG = 'steps.finalUrlInto: needs a manual redirect';
const FRESH_MSG = 'steps.finalUrlInto: must be a fresh slot';
const RAW_QUERY: IJoinTemplate = { parts: [{ literal: 'code=1' }] };
const QUERY_TEMPLATE = { lang: { $literal: 'he' } };
const URL_RULES = { handoffUrl: { url: [{ origin: HOST, paths: ['/landing'] }] } };
const MANUAL = { maxHops: 3, allow: URL_RULES.handoffUrl.url };

const PERSISTENT_AUTH = {
  kind: 'bound-device' as const,
  provider: 'syn-provider',
  clientInstanceIdField: 'clientInstanceId',
  deviceIdField: 'deviceId',
  accountField: 'account',
  freshnessMarginSeconds: 60,
};

/** The bind step, extracting the handoff URL without a rule on it. */
const PLAIN_BIND: IPostStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: {} },
  extractsToCarry: { handoffUrl: '/next', other: '/other' },
};

const BIND: IPostStep = { ...PLAIN_BIND, extractRules: URL_RULES };

const OTHER_RULED_BIND: IPostStep = {
  ...PLAIN_BIND,
  extractRules: { other: URL_RULES.handoffUrl },
};

const LANDING: IGetStep = {
  name: 'landing',
  urlTag: 'auth.login',
  method: 'GET',
  urlFromCarry: 'handoffUrl',
  extractsToCarry: {},
};

const SELF_RULED_LANDING: IGetStep = {
  ...LANDING,
  extractsToCarry: { handoffUrl: '/next' },
  extractRules: URL_RULES,
};

/** A GET whose final URL, checked by its manual redirect, is the handoff URL. */
const FINAL: IGetStep = {
  name: 'bootstrap',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: {},
  redirect: MANUAL,
  finalUrlInto: 'handoffUrl',
};

/** A text page whose handoff script, checked by its capture, sets the handoff URL. */
const HANDOFF: IPostStep = {
  name: 'login',
  urlTag: 'auth.bind',
  body: { shape: {} },
  response: 'text',
  extractsToCarry: {},
  locationCapture: { into: 'handoffUrl', userAgent: 'syn-agent', url: MANUAL.allow },
};

/** One build: its login steps and, when set, its resume steps. */
interface IBuildCase {
  readonly label: string;
  readonly steps: readonly IStepConfig[];
  readonly resume?: readonly IStepConfig[];
}

/** One refused build and its message. */
interface IRefusalCase extends IBuildCase {
  readonly expected: string;
}

/**
 * Rule input for a build case.
 * @param build - Login steps and optional resume steps.
 * @returns Rule input over a native headless block.
 */
function inputOf(build: IBuildCase): IApiDirectRuleInput {
  const call: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: build.steps };
  if (build.resume === undefined) return { call, headless: NATIVE };
  const persistentAuth = { ...PERSISTENT_AUTH, resumeSteps: build.resume };
  return { call: { ...call, persistentAuth }, headless: NATIVE };
}

const REFUSALS: readonly IRefusalCase[] = [
  {
    label: 'a raw query with a query template',
    steps: [BIND, { ...LANDING, rawQuery: RAW_QUERY, queryTemplate: QUERY_TEMPLATE }],
    expected: RAW_MSG,
  },
  { label: 'no step ruling the slot', steps: [PLAIN_BIND, LANDING], expected: RULE_MSG },
  { label: 'a url rule on another slot', steps: [OTHER_RULED_BIND, LANDING], expected: RULE_MSG },
  { label: 'the url rule after the step', steps: [LANDING, BIND], expected: RULE_MSG },
  { label: 'the step ruling its own slot', steps: [SELF_RULED_LANDING], expected: RULE_MSG },
  { label: 'a later unchecked extract', steps: [BIND, PLAIN_BIND, LANDING], expected: RULE_MSG },
  {
    label: 'a conditional rule that may leave an earlier unchecked extract',
    steps: [PLAIN_BIND, { ...BIND, runIf: { carry: 'guard', oneOf: ['yes'] } }, LANDING],
    expected: RULE_MSG,
  },
  {
    label: 'a derived carry value replacing the ruled extract',
    steps: [{ ...BIND, deriveCarry: [{ into: 'handoffUrl', parts: ['creds.nextUrl'] }] }, LANDING],
    expected: RULE_MSG,
  },
  {
    label: 'a later derived carry value replacing the ruled URL',
    steps: [
      BIND,
      {
        ...PLAIN_BIND,
        extractsToCarry: {},
        deriveCarry: [{ into: 'handoffUrl', parts: ['creds.nextUrl'] }],
      },
      LANDING,
    ],
    expected: RULE_MSG,
  },
  {
    label: 'a pre-hook replacing the ruled URL before dispatch',
    steps: [
      BIND,
      { ...LANDING, preHook: { awaitCredsField: 'nextUrl', intoCarryField: 'handoffUrl' } },
    ],
    expected: RULE_MSG,
  },
  {
    label: 'a resume step ruled only by a login step',
    steps: [BIND, LANDING],
    resume: [LANDING],
    expected: RULE_MSG,
  },
  {
    label: 'a final URL without a redirect',
    steps: [{ ...FINAL, redirect: undefined }],
    expected: MANUAL_MSG,
  },
  {
    label: 'a final URL under a follow redirect',
    steps: [{ ...FINAL, redirect: 'follow' }],
    expected: MANUAL_MSG,
  },
  {
    label: 'a blank final URL slot',
    steps: [{ ...FINAL, finalUrlInto: ' ' }],
    expected: FRESH_MSG,
  },
  {
    label: 'a final URL slot the step also extracts',
    steps: [{ ...FINAL, extractsToCarry: { handoffUrl: '/next' } }],
    expected: FRESH_MSG,
  },
  {
    label: 'a carried URL its own handoff script sets',
    steps: [{ ...LANDING, response: 'text', locationCapture: HANDOFF.locationCapture }],
    expected: RULE_MSG,
  },
  {
    label: 'a carried URL its own step finalizes',
    steps: [{ ...LANDING, redirect: MANUAL, finalUrlInto: 'handoffUrl' }],
    expected: RULE_MSG,
  },
];

const ACCEPTED: readonly IBuildCase[] = [
  { label: 'the bank flow', steps: [BIND, LANDING] },
  { label: 'a raw query alone', steps: [BIND, { ...LANDING, rawQuery: RAW_QUERY }] },
  { label: 'a query template alone', steps: [BIND, { ...LANDING, queryTemplate: QUERY_TEMPLATE }] },
  { label: 'a resume list ruling its own slot', steps: [BIND], resume: [BIND, LANDING] },
  { label: 'a carried URL an earlier final URL checked', steps: [FINAL, LANDING] },
  { label: 'a carried URL an earlier handoff script set', steps: [HANDOFF, LANDING] },
  { label: 'two checked writers', steps: [BIND, { ...BIND, name: 'login' }, LANDING] },
];

describe('validateApiDirectConfig — N40/N41 step URL rules', () => {
  it.each(REFUSALS)('refuses $label', build => {
    const input = inputOf(build);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: build.expected,
    });
  });

  it.each(ACCEPTED)('builds $label', build => {
    const input = inputOf(build);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
