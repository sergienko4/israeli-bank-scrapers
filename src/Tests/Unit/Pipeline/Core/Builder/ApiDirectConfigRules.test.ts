/**
 * E14 — an api-direct call config is checked against its bank's headless
 * block when the pipeline is built.
 *
 * Each rule has broken configs that fail with its exact `"<field>: <rule>"`
 * text and nearby configs that pass; every registered production pipeline
 * still builds under its own bank config.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import PIPELINE_REGISTRY from '../../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  IStepOutcome,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

/** The bank's headless block as the rules read it. */
type HeadlessBlock = IApiDirectRuleInput['headless'];

const JAR_ON = { sessionCookies: true } as unknown as HeadlessBlock;
const JAR_OFF = { sessionCookies: false } as unknown as HeadlessBlock;

const STEP: IStepConfig = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: { x: { $literal: 1 } } },
  extractsToCarry: { token: '/data/accessToken' },
};

const JAR_STEP: IStepConfig = { ...STEP, cookieJar: true };

const OUTCOME: IStepOutcome = {
  codePointer: '/code',
  successCodes: ['0'],
  failureMap: {},
  defaultFailure: ScraperErrorTypes.Generic,
};

const NO_CODES_STEP: IStepConfig = { ...STEP, outcome: { ...OUTCOME, successCodes: [] } };
const WARM = { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 1 };
const CLAIMS = { freshnessField: 'exp', skewSeconds: 30 } as const;

/**
 * A one-step call config with the given fields on top.
 * @param overrides - Fields to set.
 * @returns Call config literal.
 */
function makeCall(overrides: Partial<IApiDirectCallConfig> = {}): IApiDirectCallConfig {
  const base: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [STEP] };
  return { ...base, ...overrides };
}

/**
 * Durable auth whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Persistent auth block.
 */
function resumeWith(step: IStepConfig): IApiDirectCallConfig['persistentAuth'] {
  return {
    provider: 'syn-provider',
    resumeSteps: [step],
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'account',
    freshnessMarginSeconds: 60,
  };
}

/** A config, the headless block beside it, and the text it fails with. */
type BrokenCase = readonly [string, IApiDirectRuleInput, string];

const PREFIX_MSG = 'authPrefix: required when authScheme is prefixed';
const NONE_MSG = 'headless.sessionCookies: required when authScheme is none';
const JAR_MSG = 'steps.cookieJar: not allowed with headless.sessionCookies';
const CODES_MSG = 'outcome.successCodes: must not be empty';
const CLAIMS_MSG = 'jwtClaims: required when warmStart.validation is jwt';

const BROKEN: readonly BrokenCase[] = [
  [
    'prefixed, no prefix',
    { call: makeCall({ authScheme: 'prefixed' }), headless: false },
    PREFIX_MSG,
  ],
  [
    'prefixed, blank prefix',
    { call: makeCall({ authScheme: 'prefixed', authPrefix: '   ' }), headless: false },
    PREFIX_MSG,
  ],
  [
    'none, no headless block',
    { call: makeCall({ authScheme: 'none' }), headless: false },
    NONE_MSG,
  ],
  ['none, jar off', { call: makeCall({ authScheme: 'none' }), headless: JAR_OFF }, NONE_MSG],
  [
    'step jar beside session jar',
    { call: makeCall({ steps: [JAR_STEP] }), headless: JAR_ON },
    JAR_MSG,
  ],
  [
    'resume-step jar beside session jar',
    { call: makeCall({ persistentAuth: resumeWith(JAR_STEP) }), headless: JAR_ON },
    JAR_MSG,
  ],
  [
    'empty success codes',
    { call: makeCall({ steps: [NO_CODES_STEP] }), headless: false },
    CODES_MSG,
  ],
  [
    'empty success codes on a resume step',
    { call: makeCall({ persistentAuth: resumeWith(NO_CODES_STEP) }), headless: false },
    CODES_MSG,
  ],
  [
    'default jwt warm, no claims',
    { call: makeCall({ warmStart: WARM }), headless: false },
    CLAIMS_MSG,
  ],
  [
    'explicit jwt warm, no claims',
    { call: makeCall({ warmStart: { ...WARM, validation: 'jwt' } }), headless: false },
    CLAIMS_MSG,
  ],
  [
    'two broken rules report the first',
    { call: makeCall({ authScheme: 'prefixed', steps: [NO_CODES_STEP] }), headless: false },
    PREFIX_MSG,
  ],
];

/** A config the rules accept. */
type SoundCase = readonly [string, IApiDirectRuleInput];

const SOUND: readonly SoundCase[] = [
  ['minimal config', { call: makeCall(), headless: false }],
  [
    'prefixed with a prefix',
    { call: makeCall({ authScheme: 'prefixed', authPrefix: 'Scheme ' }), headless: false },
  ],
  ['none with the session jar', { call: makeCall({ authScheme: 'none' }), headless: JAR_ON }],
  ['step jar alone', { call: makeCall({ steps: [JAR_STEP] }), headless: JAR_OFF }],
  [
    'outcome with success codes',
    { call: makeCall({ steps: [{ ...STEP, outcome: OUTCOME }] }), headless: false },
  ],
  [
    'jwt warm with claims',
    { call: makeCall({ warmStart: WARM, jwtClaims: CLAIMS }), headless: false },
  ],
  [
    'bank-call warm, no claims',
    { call: makeCall({ warmStart: { ...WARM, validation: 'bank-call' } }), headless: false },
  ],
];

/**
 * Build a registered pipeline with options naming its own bank.
 * @param companyId - Registry key.
 * @returns Build result, or false when the key has no factory.
 */
function buildRegistered(companyId: CompanyTypes): Procedure<IPipelineDescriptor> | false {
  const factory = PIPELINE_REGISTRY[companyId];
  if (factory === undefined) return false;
  const opts = makeMockOptions({ companyId });
  return factory(opts);
}

const REGISTERED = Object.values(CompanyTypes).filter(
  (companyId): boolean => PIPELINE_REGISTRY[companyId] !== undefined,
);

describe('validateApiDirectConfig', () => {
  it.each(BROKEN)('%s → fails with the rule text', (_label, input, message) => {
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it.each(SOUND)('%s → passes', (_label, input) => {
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

describe('production pipelines under E14', () => {
  it('registry is not empty', () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
  });

  it.each(REGISTERED)('%s builds under its own bank config', companyId => {
    const result = buildRegistered(companyId);
    expect(result).toMatchObject({ success: true });
  });
});
