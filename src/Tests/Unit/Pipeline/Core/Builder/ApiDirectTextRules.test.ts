/**
 * N36 — `textCaptures` and `maxTextChars` need a `text` response;
 * `maxTextChars` is an integer from 1 to 2097152; a capture pattern compiles
 * with the `g` flag and repeats no group; its `group` names a group of the
 * pattern, 0 being the whole match. A capture slot may carry extract rules;
 * an `absent` guard carries nothing, so a rule on it is stray.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IGetStep,
  ITextCapture,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://text.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const SSO: ITextCapture = { pattern: String.raw`^[\s\S]*?code=([\s\S]+)$`, group: 1 };
const RESPONSE_MSG = 'steps.textCaptures: need a text response';
const CAP_RESPONSE_MSG = 'steps.maxTextChars: needs a text response';
const CAP_MSG = 'steps.maxTextChars: must be an integer from 1 to 2097152';
const COMPILE_MSG = 'steps.textCaptures.pattern: must compile';
const REPEAT_MSG = 'steps.textCaptures.pattern: must not repeat a group';
const GROUP_MSG = 'steps.textCaptures.group: must name a group of its pattern';

/**
 * A text GET step with the given extra fields.
 * @param extra - Fields over the base step.
 * @returns GET step.
 */
function textStep(extra: Partial<IGetStep>): IGetStep {
  const base: IGetStep = {
    name: 'bootstrap',
    urlTag: 'auth.bind',
    method: 'GET',
    response: 'text',
    extractsToCarry: {},
  };
  return { ...base, ...extra };
}

/**
 * Rule input running one step on native fetch.
 * @param step - The login step.
 * @returns Rule input.
 */
function runOf(step: IGetStep): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: NATIVE };
}

/**
 * A step capturing one slot with the given capture.
 * @param capture - Text capture.
 * @returns GET step.
 */
function capturing(capture: ITextCapture): IGetStep {
  return textStep({ textCaptures: { slot: capture } });
}

describe('validateApiDirectConfig — N36 text captures', () => {
  it.each<[string, IGetStep, string]>([
    [
      'captures on a json step',
      textStep({ response: 'json', textCaptures: { slot: SSO } }),
      RESPONSE_MSG,
    ],
    [
      'captures on a step with no response',
      textStep({ response: undefined, textCaptures: { slot: SSO } }),
      RESPONSE_MSG,
    ],
    [
      'a text cap on a document step',
      textStep({ response: 'document', maxTextChars: 10 }),
      CAP_RESPONSE_MSG,
    ],
    ['a zero text cap', textStep({ maxTextChars: 0 }), CAP_MSG],
    ['a fractional text cap', textStep({ maxTextChars: 1.5 }), CAP_MSG],
    ['a text cap past 2 MiB', textStep({ maxTextChars: 2_097_153 }), CAP_MSG],
    ['a pattern that does not compile', capturing({ pattern: '(]', group: 0 }), COMPILE_MSG],
    ['a repeated group', capturing({ pattern: '(a+)+b', group: 1 }), REPEAT_MSG],
    ['a repeated non-capturing group', capturing({ pattern: '(?:a|aa)*b', group: 0 }), REPEAT_MSG],
    ['a group with a counted repeat', capturing({ pattern: '(a*){40}', group: 1 }), REPEAT_MSG],
    ['a group past the count', capturing({ pattern: 'code=(\\w+)', group: 2 }), GROUP_MSG],
    ['a negative group', capturing({ pattern: 'code', group: -1 }), GROUP_MSG],
    ['a fractional group', capturing({ pattern: 'code=(\\w+)', group: 0.5 }), GROUP_MSG],
  ])('%s → fails the build', (_label, step, message) => {
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it.each<[string, IGetStep]>([
    ['the SSO suffix capture', capturing(SSO)],
    ['a whole-match capture', capturing({ pattern: String.raw`<app-root\b`, group: 0 })],
    [
      'a back-reference capture',
      capturing({ pattern: String.raw`\bbankNum\s*=\s*(["'])([^"']*)\1`, group: 2 }),
    ],
    ['an escaped paren that repeats', capturing({ pattern: String.raw`\)+x`, group: 0 })],
    ['a paren in a class that repeats', capturing({ pattern: '[)]+x', group: 0 })],
    ['an optional group', capturing({ pattern: '(a)?b', group: 1 })],
    [
      'an absent guard',
      textStep({ textCaptures: { csrf: { pattern: 'csrfToken', group: 0, absent: true } } }),
    ],
    ['a 2 MiB text cap', textStep({ maxTextChars: 2_097_152 })],
    [
      'a rule on a capture slot',
      textStep({ textCaptures: { slot: SSO }, extractRules: { slot: { maxChars: 32_768 } } }),
    ],
  ])('%s → builds', (_label, step) => {
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('refuses a rule on an absent guard as naming no extract', () => {
    const csrf: ITextCapture = { pattern: 'csrfToken', group: 0, absent: true };
    const step = textStep({ textCaptures: { csrf }, extractRules: { csrf: { maxChars: 10 } } });
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.extractRules: each key must name a body or header extract',
    });
  });
});
