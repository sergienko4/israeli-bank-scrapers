/**
 * An api-direct call config is checked against its bank's transport
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
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type {
  IApiDirectCallConfig,
  ICookieJarWarmStart,
  IStepConfig,
  IStepOutcome,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

/** The bank's transport block as the rules read it. */
type TransportBlock = IApiDirectRuleInput['transport'];

const JAR_ON = { sessionCookies: true } as unknown as TransportBlock;
const JAR_OFF = { sessionCookies: false } as unknown as TransportBlock;

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
const COLLIDING_OUTCOME: IStepOutcome = {
  ...OUTCOME,
  caseInsensitive: true,
  failureMap: {
    Locked: ScraperErrorTypes.AccountBlocked,
    locked: ScraperErrorTypes.InvalidPassword,
  },
};
const COLLIDING_STEP: IStepConfig = { ...STEP, outcome: COLLIDING_OUTCOME };
const WARM = { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 1 };
const CLAIMS = { freshnessField: 'exp', skewSeconds: 30 } as const;

/** A step that runs only when the carry says so. */
const GUARDED_STEP: IStepConfig = { ...STEP, runIf: { carry: 'route', oneOf: ['otp'] } };

/**
 * A bank-call warm config, defaulting to two steps.
 * @param fromStepIndex - First warm step.
 * @param steps - The config's steps.
 * @returns Rule input with no transport block.
 */
function bankCallFrom(fromStepIndex: number, steps = [STEP, STEP]): IApiDirectRuleInput {
  const warmStart = { ...WARM, fromStepIndex, validation: 'bank-call' } as const;
  return { call: makeCall({ warmStart, steps }), transport: false };
}

/**
 * A two-step config warm-started under JWT claims from the given step index.
 * @param fromStepIndex - First warm step.
 * @returns Rule input with no transport block.
 */
function jwtFrom(fromStepIndex: number): IApiDirectRuleInput {
  const warmStart = { ...WARM, fromStepIndex };
  return {
    call: makeCall({ warmStart, steps: [STEP, STEP], jwtClaims: CLAIMS }),
    transport: false,
  };
}

/**
 * A config with no steps, warm-started under JWT claims from the given index.
 * Index 0 still starts there, so the budget charges it as a cold flow.
 * @param fromStepIndex - Warm start index.
 * @returns Rule input with no transport block.
 */
function emptyFlowFrom(fromStepIndex: number): IApiDirectRuleInput {
  const warmStart = { ...WARM, fromStepIndex };
  return { call: makeCall({ warmStart, steps: [], jwtClaims: CLAIMS }), transport: false };
}

/** A transport block with a cookie session, as a cookie-jar warm start needs. */
const JAR_DOMAINS = {
  sessionCookies: true,
  nativeFetch: true,
  cookieDomains: ['bank.example'],
} as unknown as TransportBlock;

/** The cookie-jar binding fields a test may blank. */
type JarBinding = Partial<Pick<ICookieJarWarmStart, 'provider' | 'accountField'>>;

/**
 * A config warm-started from a cookie jar with the given ceiling.
 * @param maxTokenChars - Token ceiling.
 * @param transportConfig - Transport block beside the call.
 * @param binding - Binding fields to set on top.
 * @returns Rule input.
 */
function cookieJarWarm(
  maxTokenChars: number,
  transportConfig = JAR_DOMAINS,
  binding: JarBinding = {},
): IApiDirectRuleInput {
  const warmStart = {
    kind: 'cookie-jar',
    credsField: 'otpLongTermToken',
    fromStepIndex: 1,
    validation: 'bank-call',
    provider: 'syn-bank',
    accountField: 'userCode',
    maxTokenChars,
    ...binding,
  } as const;
  return { call: makeCall({ warmStart, steps: [STEP, STEP] }), transport: transportConfig };
}

/**
 * A cookie-jar config with some binding fields replaced.
 * @param binding - Binding fields to set.
 * @returns Rule input otherwise sound.
 */
function jarBinding(binding: JarBinding): IApiDirectRuleInput {
  return cookieJarWarm(1, JAR_DOMAINS, binding);
}

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
    kind: 'bound-device' as const,
    provider: 'syn-provider',
    resumeSteps: [step],
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'account',
    freshnessMarginSeconds: 60,
  };
}

/** A config, the transport block beside it, and the text it fails with. */
type BrokenCase = readonly [string, IApiDirectRuleInput, string];

const PREFIX_MSG = 'authPrefix: required when authScheme is prefixed';
const NONE_MSG = 'transport.sessionCookies: required when authScheme is none';
const JAR_MSG = 'steps.cookieJar: not allowed with transport.sessionCookies';
const CODES_MSG = 'outcome.successCodes: must not be empty';
const COLLISION_MSG = 'outcome.failureMap: duplicate keys ignoring case';
const CLAIMS_MSG = 'jwtClaims: required when warmStart.validation is jwt';
const BANK_CALL_MSG = 'warmStart.fromStepIndex: must name a step when validation is bank-call';
const FIRST_STEP_MSG = 'warmStart.fromStepIndex: must start after the first step';
const RANGE_MSG = 'warmStart.fromStepIndex: must be a whole number up to the step count';
const MAX_TOKEN_MSG = 'warmStart.maxTokenChars: must be an integer from 1 to 16384';
const JAR_WARM_MSG = 'warmStart.kind: cookie-jar not allowed without transport.cookieDomains';
const GUARDED_ENTRY_MSG = 'warmStart.fromStepIndex: a bank-call check step must not have runIf';
const PROVIDER_MSG = 'warmStart.provider: must not be blank';
const ACCOUNT_FIELD_MSG = 'warmStart.accountField: must not be blank';
const DEVICE_IDENTITY_MSG = 'deviceIdentity.seedSlot: must differ from credential';

/** A declaration that tries to keep the seed and the signature in one field. */
const DUPLICATE_DEVICE_FIELDS = {
  seedCarryFromCreds: ['deviceSignature'],
  deviceIdentity: {
    credential: 'deviceSignature',
    format: 'risk-minder-mfp',
    seedSlot: 'deviceSignature',
    scopeField: 'userCode',
  },
  warmStart: {
    kind: 'carry-bundle',
    credsField: 'otpLongTermToken',
    fromStepIndex: 1,
    validation: 'bank-call',
    provider: 'syn-bank',
    accountFields: ['userCode'],
    slots: ['deviceSignature'],
    maxTokenChars: 4096,
    cookies: false,
    coldFallback: 'auth-rejected',
  },
} as const;

const BROKEN: readonly BrokenCase[] = [
  [
    'prefixed, no prefix',
    { call: makeCall({ authScheme: 'prefixed' }), transport: false },
    PREFIX_MSG,
  ],
  [
    'prefixed, blank prefix',
    { call: makeCall({ authScheme: 'prefixed', authPrefix: '   ' }), transport: false },
    PREFIX_MSG,
  ],
  [
    'none, no headless block',
    { call: makeCall({ authScheme: 'none' }), transport: false },
    NONE_MSG,
  ],
  ['none, jar off', { call: makeCall({ authScheme: 'none' }), transport: JAR_OFF }, NONE_MSG],
  [
    'step jar beside session jar',
    { call: makeCall({ steps: [JAR_STEP] }), transport: JAR_ON },
    JAR_MSG,
  ],
  [
    'resume-step jar beside session jar',
    { call: makeCall({ persistentAuth: resumeWith(JAR_STEP) }), transport: JAR_ON },
    JAR_MSG,
  ],
  [
    'empty success codes',
    { call: makeCall({ steps: [NO_CODES_STEP] }), transport: false },
    CODES_MSG,
  ],
  [
    'empty success codes on a resume step',
    { call: makeCall({ persistentAuth: resumeWith(NO_CODES_STEP) }), transport: false },
    CODES_MSG,
  ],
  [
    'case-insensitive failure keys collide on a login step',
    { call: makeCall({ steps: [COLLIDING_STEP] }), transport: false },
    COLLISION_MSG,
  ],
  [
    'case-insensitive failure keys collide on a resume step',
    { call: makeCall({ persistentAuth: resumeWith(COLLIDING_STEP) }), transport: false },
    COLLISION_MSG,
  ],
  [
    'default jwt warm, no claims',
    { call: makeCall({ warmStart: WARM }), transport: false },
    CLAIMS_MSG,
  ],
  [
    'explicit jwt warm, no claims',
    { call: makeCall({ warmStart: { ...WARM, validation: 'jwt' } }), transport: false },
    CLAIMS_MSG,
  ],
  ['bank-call warm past the last step', bankCallFrom(2), BANK_CALL_MSG],
  ['bank-call warm before the first step', bankCallFrom(-1), BANK_CALL_MSG],
  ['bank-call warm between steps', bankCallFrom(0.5), BANK_CALL_MSG],
  ['bank-call warm from the first step', bankCallFrom(0), FIRST_STEP_MSG],
  [
    'jwt warm from the first step',
    {
      call: makeCall({ warmStart: { ...WARM, fromStepIndex: 0 }, jwtClaims: CLAIMS }),
      transport: false,
    },
    FIRST_STEP_MSG,
  ],
  ['jwt warm at 0 over an empty flow', emptyFlowFrom(0), FIRST_STEP_MSG],
  ['jwt warm between steps', jwtFrom(1.5), RANGE_MSG],
  ['jwt warm from NaN', jwtFrom(Number.NaN), RANGE_MSG],
  ['jwt warm beyond the step count', jwtFrom(3), RANGE_MSG],
  ['cookie-jar warm with a zero ceiling', cookieJarWarm(0), MAX_TOKEN_MSG],
  ['cookie-jar warm over the seed ceiling', cookieJarWarm(16385), MAX_TOKEN_MSG],
  ['cookie-jar warm with a fractional ceiling', cookieJarWarm(1.5), MAX_TOKEN_MSG],
  ['cookie-jar warm without a headless block', cookieJarWarm(1, false), JAR_WARM_MSG],
  ['cookie-jar warm without cookie domains', cookieJarWarm(1, JAR_ON), JAR_WARM_MSG],
  ['bank-call warm from a guarded first step', bankCallFrom(0, [GUARDED_STEP]), FIRST_STEP_MSG],
  [
    'bank-call warm from a guarded later step',
    bankCallFrom(1, [STEP, GUARDED_STEP]),
    GUARDED_ENTRY_MSG,
  ],
  ['cookie-jar warm with a blank provider', jarBinding({ provider: ' ' }), PROVIDER_MSG],
  ['cookie-jar warm with an empty provider', jarBinding({ provider: '' }), PROVIDER_MSG],
  [
    'cookie-jar warm with a blank account field',
    jarBinding({ accountField: '' }),
    ACCOUNT_FIELD_MSG,
  ],
  [
    'device identity uses one field for seed and signature',
    { call: makeCall({ ...DUPLICATE_DEVICE_FIELDS, steps: [STEP, STEP] }), transport: false },
    DEVICE_IDENTITY_MSG,
  ],
  [
    'two broken rules report the first',
    { call: makeCall({ authScheme: 'prefixed', steps: [NO_CODES_STEP] }), transport: false },
    PREFIX_MSG,
  ],
];

/** A config the rules accept. */
type SoundCase = readonly [string, IApiDirectRuleInput];

const SOUND: readonly SoundCase[] = [
  ['minimal config', { call: makeCall(), transport: false }],
  [
    'prefixed with a prefix',
    { call: makeCall({ authScheme: 'prefixed', authPrefix: 'Scheme ' }), transport: false },
  ],
  ['none with the session jar', { call: makeCall({ authScheme: 'none' }), transport: JAR_ON }],
  ['step jar alone', { call: makeCall({ steps: [JAR_STEP] }), transport: JAR_OFF }],
  [
    'outcome with success codes',
    { call: makeCall({ steps: [{ ...STEP, outcome: OUTCOME }] }), transport: false },
  ],
  [
    'case-sensitive failure keys retain distinct mappings',
    {
      call: makeCall({
        steps: [{ ...COLLIDING_STEP, outcome: { ...COLLIDING_OUTCOME, caseInsensitive: false } }],
      }),
      transport: false,
    },
  ],
  [
    'jwt warm past the last step, with claims',
    { call: makeCall({ warmStart: WARM, jwtClaims: CLAIMS }), transport: false },
  ],
  ['bank-call warm from the second step, no claims', bankCallFrom(1)],
  ['jwt warm from the second step', jwtFrom(1)],
  ['jwt warm at the step count passes validation', jwtFrom(2)],
  ['cookie-jar warm at the lowest ceiling', cookieJarWarm(1)],
  ['cookie-jar warm at the seed ceiling', cookieJarWarm(16384)],
  ['bank-call warm past a guarded step', bankCallFrom(1, [GUARDED_STEP, STEP])],
  [
    'jwt warm from a guarded step',
    {
      call: makeCall({ warmStart: WARM, jwtClaims: CLAIMS, steps: [STEP, GUARDED_STEP] }),
      transport: false,
    },
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

describe('production pipelines under the api-direct config rules', () => {
  it('registry is not empty', () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
  });

  it.each(REGISTERED)('%s builds under its own bank config', companyId => {
    const result = buildRegistered(companyId);
    expect(result).toMatchObject({ success: true });
  });
});
