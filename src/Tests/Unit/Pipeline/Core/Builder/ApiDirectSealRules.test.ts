/**
 * N10 / N44 — a step's seal must name a known kind, sit on a POST step whose
 * body is a record, write at JSON pointers, and carry constants the seal can
 * use; a multi-field seal needs at least one field and non-overlapping targets.
 * Each broken seal fails the build with its own message.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IGetStep,
  IPostStep,
  ISealFieldConfig,
  ISealRsaBlockXorConfig,
  ISealRsaBlockXorParams,
  ISealRsaPkcs1Config,
  IStepConfig,
  SealKind,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { SEAL_PARAMS } from '../../../../Helpers/SealOpener.js';

const KIND_MSG = 'steps.seal.kind: unknown seal kind';
const HOST_MSG = 'steps.seal: needs a POST step with a record body';
const POINTER_MSG = 'steps.seal.writeTo: must be a JSON pointer';
const PARAMS_MSG = 'steps.seal.params: out of range';
const FIELDS_MSG = 'steps.seal.fields: needs at least one field with non-overlapping writeTo paths';

const SEAL: ISealRsaBlockXorConfig = {
  kind: 'rsa-pkcs1-block-xor',
  sourceRef: 'creds.password',
  modulusRef: 'carry.modulus',
  writeTo: '/credentials',
  params: SEAL_PARAMS,
};

/**
 * A POST step sealing with the given config into a record body.
 * @param seal - Seal config.
 * @returns POST step.
 */
function postWith(seal: ISealFieldConfig): IPostStep {
  const shape = { credentials: { $literal: '' } };
  return { name: 'login', urlTag: 'auth.login', body: { shape }, seal, extractsToCarry: {} };
}

/**
 * Rule input running one step.
 * @param step - The login step.
 * @returns Rule input.
 */
function runOf(step: IStepConfig): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: false };
}

/**
 * Validate one step.
 * @param step - The login step.
 * @returns The validation procedure.
 */
function validate(step: IStepConfig): ReturnType<typeof validateApiDirectConfig> {
  const input = runOf(step);
  return validateApiDirectConfig(input);
}

/**
 * The seal config with one params field replaced.
 * @param patch - Params override.
 * @returns Seal config.
 */
function sealWithParams(
  patch: Partial<Record<keyof ISealRsaBlockXorParams, unknown>>,
): ISealFieldConfig {
  const params = { ...SEAL_PARAMS, ...patch } as ISealRsaBlockXorParams;
  return { ...SEAL, params };
}

const GET_STEP: IGetStep = {
  name: 'login',
  urlTag: 'auth.login',
  method: 'GET',
  seal: SEAL,
  extractsToCarry: {},
};

const ARRAY_BODY_STEP: IPostStep = { ...postWith(SEAL), body: { shape: [{ $literal: '' }] } };
const REF_BODY_STEP: IPostStep = { ...postWith(SEAL), body: { shape: { $ref: 'carry.body' } } };
const JOIN_BODY_STEP: IPostStep = {
  ...postWith(SEAL),
  body: { shape: { $join: { parts: ['carry.body'] } } },
};
const UNKNOWN_KIND = { ...SEAL, kind: 'rsa-oaep' as unknown as SealKind } as ISealFieldConfig;

const PKCS1_SEAL: ISealRsaPkcs1Config = {
  kind: 'rsa-pkcs1-v15',
  keyRef: 'carry.rsaKey',
  fields: [
    { sourceRef: 'creds.num', writeTo: '/ThirdIdentifier' },
    { sourceRef: 'creds.password', writeTo: '/Password' },
  ],
};

/**
 * The PKCS#1 seal with the given fields.
 * @param fields - Sealed fields.
 * @returns Seal config.
 */
function pkcs1With(fields: ISealRsaPkcs1Config['fields']): ISealRsaPkcs1Config {
  return { ...PKCS1_SEAL, fields };
}

/**
 * A multi-field seal writing to two chosen paths.
 * @param first - First target.
 * @param second - Second target.
 * @returns Seal config.
 */
function pkcs1At(first: string, second: string): ISealRsaPkcs1Config {
  const fields = [
    { ...PKCS1_SEAL.fields[0], writeTo: first },
    { ...PKCS1_SEAL.fields[1], writeTo: second },
  ];
  return pkcs1With(fields);
}

const BAD_PARAMS: readonly (readonly [
  string,
  Partial<Record<keyof ISealRsaBlockXorParams, unknown>>,
])[] = [
  ['an even exponent', { exponent: 65536 }],
  ['an exponent under 3', { exponent: 1 }],
  ['a fractional exponent', { exponent: 3.5 }],
  ['a zero seed length', { seedLength: 0 }],
  ['a seed length over 64', { seedLength: 65 }],
  ['an empty alphabet', { seedAlphabet: '' }],
  ['a non-ASCII alphabet', { seedAlphabet: 'abcé' }],
  ['zero block characters', { blockChars: 0 }],
  ['54 block characters', { blockChars: 54 }],
  ['a non-ASCII prefix', { prefix: '[ÉNC]' }],
  ['an empty block separator', { blockSeparator: '' }],
  ['an empty terminator', { envelopeTerminator: '' }],
];

describe('validateApiDirectConfig — sealed fields', () => {
  it('an unknown seal kind fails the build', () => {
    const step = postWith(UNKNOWN_KIND);
    const result = validate(step);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: KIND_MSG,
    });
  });

  it.each([
    ['a GET step', GET_STEP],
    ['an array body', ARRAY_BODY_STEP],
    ['a $ref body', REF_BODY_STEP],
    ['a $join body', JOIN_BODY_STEP],
  ])('a seal on %s fails the build', (_label, step) => {
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: HOST_MSG });
  });

  it.each([['credentials'], ['/'], [''], ['/Credentials~2'], ['/Credentials~']])(
    'writeTo %j fails the build',
    writeTo => {
      const step = postWith({ ...SEAL, writeTo });
      const result = validate(step);
      expect(result).toMatchObject({ success: false, errorMessage: POINTER_MSG });
    },
  );

  it.each(BAD_PARAMS)('%s fails the build', (_label, patch) => {
    const seal = sealWithParams(patch);
    const step = postWith(seal);
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: PARAMS_MSG });
  });

  it('a sound seal passes, at both block-size bounds', () => {
    const bounds = [1, 53].map((blockChars): IPostStep => {
      const seal = sealWithParams({ blockChars });
      return postWith(seal);
    });
    const results = bounds.map(validate);
    expect(results).toEqual([
      { success: true, value: true },
      { success: true, value: true },
    ]);
  });

  it('a seal in a durable resume step is checked too', () => {
    const resumeSteps = [postWith(UNKNOWN_KIND)];
    const persistentAuth = { kind: 'bound-device', resumeSteps } as unknown as NonNullable<
      IApiDirectRuleInput['call']['persistentAuth']
    >;
    const call = { flow: 'sms-otp' as const, envelope: {}, steps: [], persistentAuth };
    const result = validateApiDirectConfig({ call, headless: false });
    expect(result).toMatchObject({ success: false, errorMessage: KIND_MSG });
  });
});

describe('validateApiDirectConfig — fields sealed with RSA PKCS#1 v1.5 (N44)', () => {
  it('a sound multi-field seal passes', () => {
    const step = postWith(PKCS1_SEAL);
    const result = validate(step);
    expect(result).toEqual({ success: true, value: true });
  });

  it('a seal on a GET step fails the build', () => {
    const step: IGetStep = { ...GET_STEP, seal: PKCS1_SEAL };
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: HOST_MSG });
  });

  it.each([['Password'], ['/'], [''], ['/Password~2'], ['/Password~']])(
    'a field writeTo %j fails the build',
    writeTo => {
      const fields = [PKCS1_SEAL.fields[0], { sourceRef: 'creds.password' as const, writeTo }];
      const seal = pkcs1With(fields);
      const step = postWith(seal);
      const result = validate(step);
      expect(result).toMatchObject({ success: false, errorMessage: POINTER_MSG });
    },
  );

  it.each([
    ['no fields', []],
    [
      'two fields at one writeTo',
      [
        { sourceRef: 'creds.num' as const, writeTo: '/Password' },
        { sourceRef: 'creds.password' as const, writeTo: '/Password' },
      ],
    ],
  ])('%s fails the build', (_label, fields) => {
    const seal = pkcs1With(fields);
    const step = postWith(seal);
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: FIELDS_MSG });
  });

  it('a fields list omitted at runtime fails the build, not a throw', () => {
    const omitted = { ...PKCS1_SEAL, fields: undefined } as unknown as ISealRsaPkcs1Config;
    const step = postWith(omitted);
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: FIELDS_MSG });
  });

  it.each([
    ['/Credentials', '/Credentials/Password'],
    ['/Credentials/Password', '/Credentials'],
    ['/Credentials~02', '/Credentials~02/Password'],
  ])('refuses overlapping seal targets %s and %s', (first, second) => {
    const seal = pkcs1At(first, second);
    const step = postWith(seal);
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: FIELDS_MSG });
  });

  it.each([
    ['/Credentials', '/Credentials2/Password'],
    ['/Credentials', '/Credentials~1Password'],
  ])('accepts distinct seal targets %s and %s', (first, second) => {
    const seal = pkcs1At(first, second);
    const step = postWith(seal);
    const result = validate(step);
    expect(result).toEqual({ success: true, value: true });
  });
});
