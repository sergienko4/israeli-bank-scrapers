/**
 * Build rule — an optional ref drops its key when its source has no
 * value, so it may stand only as the value of a body or query-template key.
 * One at a root, inside an array or in a header fails the build.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IPostStep,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://ref.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const OPTIONAL_DID: JsonValueTemplate = { $ref: 'carry.did', optional: true };
const PLAIN_DID: JsonValueTemplate = { $ref: 'carry.did' };

const PERSISTENT_AUTH = {
  kind: 'bound-device' as const,
  provider: 'syn-provider',
  clientInstanceIdField: 'clientInstanceId',
  deviceIdField: 'deviceId',
  accountField: 'account',
  freshnessMarginSeconds: 60,
};

/**
 * A login POST step with the given body shape.
 * @param shape - Body shape.
 * @returns POST step.
 */
function postWith(shape: JsonValueTemplate): IPostStep {
  return { name: 'login', urlTag: 'auth.login', body: { shape }, extractsToCarry: {} };
}

/**
 * An identify GET step with the given query template.
 * @param queryTemplate - Query template.
 * @returns GET step.
 */
function getWith(queryTemplate: JsonValueTemplate): IGetStep {
  return {
    name: 'identify',
    urlTag: 'auth.bind',
    method: 'GET',
    queryTemplate,
    extractsToCarry: {},
  };
}

/** One build: its login steps and, when set, its resume steps. */
interface IBuildCase {
  readonly label: string;
  readonly steps: readonly IStepConfig[];
  readonly resume?: readonly IStepConfig[];
}

/**
 * Rule input for a build case.
 * @param build - Login steps and optional resume steps.
 * @returns Rule input over a native transport block.
 */
function inputOf(build: IBuildCase): IApiDirectRuleInput {
  const call: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: build.steps };
  if (build.resume === undefined) return { call, transport: NATIVE };
  const persistentAuth = { ...PERSISTENT_AUTH, resumeSteps: build.resume };
  return { call: { ...call, persistentAuth }, transport: NATIVE };
}

const BODY_ENTRY = postWith({ user: { $literal: 'u' }, did: OPTIONAL_DID });

const REFUSALS: readonly IBuildCase[] = [
  { label: 'one as the body', steps: [postWith(OPTIONAL_DID)] },
  { label: 'one in a body array', steps: [postWith({ ids: [OPTIONAL_DID] })] },
  { label: 'one as a header', steps: [{ ...BODY_ENTRY, headers: { 'X-Did': OPTIONAL_DID } }] },
  {
    label: 'one inside a header record',
    steps: [{ ...BODY_ENTRY, headers: { 'X-Ids': { did: OPTIONAL_DID } } }],
  },
  { label: 'one as the query template', steps: [getWith(OPTIONAL_DID)] },
  { label: 'one in a resume step array', steps: [BODY_ENTRY], resume: [postWith([OPTIONAL_DID])] },
];

const ACCEPTED: readonly IBuildCase[] = [
  { label: 'a body key', steps: [BODY_ENTRY] },
  { label: 'a nested body key', steps: [postWith({ data: { did: OPTIONAL_DID } })] },
  { label: 'a query key', steps: [getWith({ aid: { $literal: 'a' }, did: OPTIONAL_DID })] },
  { label: 'a plain ref anywhere', steps: [postWith([PLAIN_DID]), getWith({ did: PLAIN_DID })] },
  { label: 'an optional ref as $literal data', steps: [postWith({ $literal: OPTIONAL_DID })] },
];

describe('validateApiDirectConfig — optional ref rule', () => {
  it.each(REFUSALS)('refuses $label', build => {
    const input = inputOf(build);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'steps: optional ref only as an object value',
    });
  });

  it.each(ACCEPTED)('builds $label', build => {
    const input = inputOf(build);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
