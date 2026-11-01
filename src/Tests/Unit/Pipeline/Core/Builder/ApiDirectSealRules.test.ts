/**
 * N10 — a step's seal must name a known kind, sit on a POST step whose body
 * is a record, write at a JSON pointer, and carry constants the seal can use.
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
  ISealRsaBlockXorParams,
  IStepConfig,
  SealKind,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { SEAL_PARAMS } from '../../../../Helpers/SealOpener.js';

const KIND_MSG = 'steps.seal.kind: unknown seal kind';
const HOST_MSG = 'steps.seal: needs a POST step with a record body';
const POINTER_MSG = 'steps.seal.writeTo: must be a JSON pointer';
const PARAMS_MSG = 'steps.seal.params: out of range';

const SEAL: ISealFieldConfig = {
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
const UNKNOWN_KIND = { ...SEAL, kind: 'rsa-oaep' as unknown as SealKind };

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

  it.each([['credentials'], ['/'], ['']])('writeTo %j fails the build', writeTo => {
    const step = postWith({ ...SEAL, writeTo });
    const result = validate(step);
    expect(result).toMatchObject({ success: false, errorMessage: POINTER_MSG });
  });

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
