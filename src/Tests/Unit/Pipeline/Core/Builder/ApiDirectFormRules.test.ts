/**
 * N9 — a form step's body must be a flat record whose every value is one
 * `$ref`, or one `$literal` string, finite number or boolean. Anything nested
 * fails the build; JSON steps keep any shape.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IPostStep,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://form.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const FLAT_MSG = 'steps.body: a form body must be a flat record';

const FLAT: JsonValueTemplate = {
  user: { $ref: 'creds.userCode' },
  mfp: { $literal: '' },
  n: { $literal: 2 },
  ok: { $literal: true },
};

/**
 * A step sending the given body shape.
 * @param shape - Body shape.
 * @param encoding - Body encoding, form when absent.
 * @returns POST step.
 */
function stepWith(shape: JsonValueTemplate, encoding: IPostStep['encoding'] = 'form'): IPostStep {
  return { name: 'login', urlTag: 'auth.login', encoding, body: { shape }, extractsToCarry: {} };
}

/**
 * Rule input running one step on native fetch.
 * @param step - The login step.
 * @returns Rule input.
 */
function runOf(step: IPostStep): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: NATIVE };
}

const BROKEN: readonly (readonly [string, JsonValueTemplate])[] = [
  ['nested record', { a: { b: { $literal: 'x' } } }],
  ['array value', { a: [{ $literal: 'x' }] }],
  ['literal object', { a: { $literal: { b: 1 } } }],
  ['literal array', { a: { $literal: ['x'] } }],
  ['literal null', { a: { $literal: null } }],
  ['literal NaN', { a: { $literal: Number.NaN } }],
  ['ref plus literal', { a: { $ref: 'carry.x', $literal: 'y' } }],
  ['array root', [{ $literal: 'x' }]],
  ['ref root', { $ref: 'carry.form' }],
];

describe('validateApiDirectConfig — form bodies', () => {
  it.each(BROKEN)('%s → fails the build', (_label, shape) => {
    const step = stepWith(shape);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: FLAT_MSG,
    });
  });

  it('a flat form record passes', () => {
    const step = stepWith(FLAT);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('a nested JSON body passes', () => {
    const step = stepWith(BROKEN[0][1], 'json');
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
