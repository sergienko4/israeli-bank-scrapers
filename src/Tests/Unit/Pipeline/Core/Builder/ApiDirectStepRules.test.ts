/**
 * Step rules on login and resume steps alike. N20 — each `failIfPresent`
 * entry must be a JSON pointer below the body root. N18 — each `extractRules`
 * key names a body extract of its step; a pattern is anchored and compiles;
 * `maxChars` is an integer from 1 to 65536; `oneOf` and `url` are not empty.
 * N14 — a `runIf` guard names a slot and texts. N21 — a pre-hook's
 * `valuePattern` is anchored and compiles.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const POINTER_MSG = 'steps.failIfPresent: each entry must be a JSON pointer';

/**
 * A login step guarded by the given pointers.
 * @param pointers - The `failIfPresent` entries.
 * @returns Step config.
 */
function guarded(pointers: readonly string[]): IStepConfig {
  return {
    name: 'bind',
    urlTag: 'auth.bind',
    body: { shape: {} },
    extractsToCarry: {},
    failIfPresent: pointers,
  };
}

/**
 * Rule input running the step as the one login step.
 * @param step - The guarded step.
 * @returns Rule input.
 */
function runOf(step: IStepConfig): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: false };
}

/**
 * Rule input whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Rule input.
 */
function resumeOf(step: IStepConfig): IApiDirectRuleInput {
  const persistentAuth = {
    provider: 'syn-provider',
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'account',
    freshnessMarginSeconds: 60,
    resumeSteps: [step],
  };
  const login = guarded(['/error']);
  return {
    call: { flow: 'sms-otp', envelope: {}, steps: [login], persistentAuth },
    headless: false,
  };
}

describe('validateApiDirectConfig — failIfPresent', () => {
  it.each([
    ['an empty entry', ['']],
    ['the body root', ['/']],
    ['a bare key', ['errors']],
    ['one bad entry among good ones', ['/error', 'Error']],
  ])('%s → fails the build', (_label, pointers) => {
    const step = guarded(pointers);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: POINTER_MSG,
    });
  });

  it('checks resume steps too', () => {
    const step = guarded(['errors']);
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: POINTER_MSG });
  });

  it('JSON pointers pass', () => {
    const step = guarded(['/error', '/Error', '/errors']);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

/**
 * A login step reading `state` (required) and `target` (optional), ruled.
 * @param rules - The `extractRules` record.
 * @returns Step config.
 */
function ruled(rules: IStepConfig['extractRules']): IStepConfig {
  return {
    name: 'bind',
    urlTag: 'auth.bind',
    body: { shape: {} },
    extractsToCarry: { state: '/state' },
    optionalExtractsToCarry: { target: { pointer: '/target' } },
    extractRules: rules,
  };
}

const KEY_MSG = 'steps.extractRules: each key must name a body extract';
const PATTERN_MSG = 'steps.extractRules.pattern: must be an anchored regex';
const MAX_MSG = 'steps.extractRules.maxChars: must be an integer from 1 to 65536';
const EMPTY_MSG = 'steps.extractRules: oneOf and url must not be empty';
const PORTAL = [{ origin: 'https://bank.example', paths: ['/portal/home'] }];

describe('validateApiDirectConfig — extractRules', () => {
  it.each<[string, IStepConfig['extractRules'], string]>([
    ['a key naming no extract', { other: { type: 'string' } }, KEY_MSG],
    ['an unanchored pattern', { state: { pattern: String.raw`\d+` } }, PATTERN_MSG],
    ['a pattern without its end anchor', { state: { pattern: String.raw`^\d+` } }, PATTERN_MSG],
    ['a pattern that does not compile', { state: { pattern: '^(]$' } }, PATTERN_MSG],
    ['a zero maxChars', { state: { maxChars: 0 } }, MAX_MSG],
    ['a fractional maxChars', { state: { maxChars: 1.5 } }, MAX_MSG],
    ['a maxChars past 65536', { target: { maxChars: 65537 } }, MAX_MSG],
    ['an empty oneOf', { state: { oneOf: [] } }, EMPTY_MSG],
    ['an empty url list', { target: { url: [] } }, EMPTY_MSG],
  ])('%s → fails the build', (_label, rules, message) => {
    const step = ruled(rules);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it('checks resume steps too', () => {
    const step = ruled({ other: { type: 'string' } });
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: KEY_MSG });
  });

  it('sound rules on required and optional slots pass', () => {
    const state = {
      type: 'string',
      transform: 'lower',
      oneOf: ['logonotp'],
      pattern: '^[a-z]+$',
    } as const;
    const step = ruled({ state, target: { url: PORTAL, maxChars: 65536 } });
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

const RUN_IF_MSG = 'steps.runIf: carry and oneOf must not be empty';

/**
 * A step guarded by `runIf`.
 * @param runIf - The guard.
 * @returns Step config.
 */
function runIfStep(runIf: IStepConfig['runIf']): IStepConfig {
  return { name: 'bind', urlTag: 'auth.bind', body: { shape: {} }, extractsToCarry: {}, runIf };
}

describe('validateApiDirectConfig — runIf', () => {
  it.each<[string, IStepConfig['runIf']]>([
    ['a blank carry slot', { carry: ' ', oneOf: ['logonotp'] }],
    ['an empty oneOf', { carry: 'state', oneOf: [] }],
  ])('%s → fails the build', (_label, runIf) => {
    const step = runIfStep(runIf);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: RUN_IF_MSG });
  });

  it('checks resume steps too', () => {
    const step = runIfStep({ carry: 'state', oneOf: [] });
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: RUN_IF_MSG });
  });

  it('a sound guard passes', () => {
    const step = runIfStep({ carry: 'state', oneOf: ['logonotp'] });
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

const VALUE_PATTERN_MSG = 'steps.preHook.valuePattern: must be an anchored regex';

/**
 * A login step whose OTP pre-hook checks the code against a pattern.
 * @param valuePattern - The pre-hook's `valuePattern`.
 * @returns Step config.
 */
function hookedStep(valuePattern: string): IStepConfig {
  const preHook = { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otp', valuePattern };
  return { name: 'login', urlTag: 'auth.login', body: { shape: {} }, extractsToCarry: {}, preHook };
}

describe('validateApiDirectConfig — preHook.valuePattern', () => {
  it.each([
    ['an unanchored pattern', String.raw`\d{5}`],
    ['a pattern without its end anchor', String.raw`^\d{5}`],
    ['a pattern that does not compile', '^(]$'],
  ])('%s → fails the build', (_label, valuePattern) => {
    const step = hookedStep(valuePattern);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: VALUE_PATTERN_MSG });
  });

  it('checks resume steps too', () => {
    const step = hookedStep(String.raw`\d{5}`);
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: VALUE_PATTERN_MSG });
  });

  it('an anchored pattern passes', () => {
    const step = hookedStep(String.raw`^\d{5}$`);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
