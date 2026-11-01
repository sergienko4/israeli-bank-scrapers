/**
 * N40/N41 build rules — a raw query replaces the query template, never joins
 * it; a carried step URL (a GET's, by type) reads a slot that an earlier step
 * in the same list checked with an `extractRules` `url` rule.
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
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const RAW_MSG = 'steps.rawQuery: not with queryTemplate';
const RULE_MSG = 'steps.urlFromCarry: slot needs an earlier url rule';
const RAW_QUERY: IJoinTemplate = { parts: [{ literal: 'code=1' }] };
const QUERY_TEMPLATE = { lang: { $literal: 'he' } };
const URL_RULES = { handoffUrl: { url: [{ origin: HOST, paths: ['/landing'] }] } };

const PERSISTENT_AUTH = {
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
  {
    label: 'a resume step ruled only by a login step',
    steps: [BIND, LANDING],
    resume: [LANDING],
    expected: RULE_MSG,
  },
];

const ACCEPTED: readonly IBuildCase[] = [
  { label: 'the bank flow', steps: [BIND, LANDING] },
  { label: 'a raw query alone', steps: [BIND, { ...LANDING, rawQuery: RAW_QUERY }] },
  { label: 'a query template alone', steps: [BIND, { ...LANDING, queryTemplate: QUERY_TEMPLATE }] },
  { label: 'a resume list ruling its own slot', steps: [BIND], resume: [BIND, LANDING] },
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
