/**
 * Step rules on login and resume steps alike. Each `failIfPresent` entry
 * must be a JSON pointer below the body root, and a `bankErrorType` needs a
 * `failIfPresent` guard or a codec to type. Each `extractRules` key names a
 * body or header extract of its step; a pattern is anchored, compiles and
 * repeats no group that holds a repeat; `maxChars` is an integer from 1 to
 * 65536; `oneOf` and `url` are not empty. A `runIf` guard names a slot and
 * texts. A pre-hook's `valuePattern` obeys the same pattern rules.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
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
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, transport: false };
}

/**
 * Rule input whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Rule input.
 */
function resumeOf(step: IStepConfig): IApiDirectRuleInput {
  const persistentAuth = {
    kind: 'bound-device' as const,
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
    transport: false,
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

describe('validateApiDirectConfig — bankErrorType', () => {
  const typeMsg = 'steps.bankErrorType: needs failIfPresent or a codec';
  const typeOf = { bankErrorType: ScraperErrorTypes.InvalidPassword };

  it.each([
    ['no guard', guarded([])],
    ['an unset guard', { ...guarded(['/error']), failIfPresent: undefined }],
  ])('a typed step with %s and no codec → fails the build', (_label, step) => {
    const input = runOf({ ...step, ...typeOf });
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: typeMsg });
  });

  it('checks resume steps too', () => {
    const step = { ...guarded([]), ...typeOf };
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: typeMsg });
  });

  it('a typed, guarded step passes', () => {
    const step = { ...guarded(['/error']), ...typeOf };
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

const KEY_MSG = 'steps.extractRules: each key must name a body or header extract';
const PATTERN_MSG = 'steps.extractRules.pattern: must be an anchored regex';
const FLAT_MSG = 'steps.extractRules.pattern: must be a flat regex';
const MAX_MSG = 'steps.extractRules.maxChars: must be an integer from 1 to 65536';
const EMPTY_MSG = 'steps.extractRules: oneOf and url must not be empty';
const PORTAL = [{ origin: 'https://bank.example', paths: ['/portal/home'] }];
const NATIVE = {
  identityBase: 'https://bank.example',
  graphql: 'https://bank.example/graphql',
  paths: {},
  nativeFetch: true,
};

describe('validateApiDirectConfig — extractRules', () => {
  it.each<[string, IStepConfig['extractRules'], string]>([
    ['a key naming no extract', { other: { type: 'string' } }, KEY_MSG],
    ['an unanchored pattern', { state: { pattern: String.raw`\d+` } }, PATTERN_MSG],
    ['a pattern without its end anchor', { state: { pattern: String.raw`^\d+` } }, PATTERN_MSG],
    ['a pattern that does not compile', { state: { pattern: '^(]$' } }, PATTERN_MSG],
    ['a group', { state: { pattern: String.raw`^(\d+)+$` } }, FLAT_MSG],
    ['a non-capturing group', { state: { pattern: '^(?:a?){40}$' } }, FLAT_MSG],
    ['a lookahead', { state: { pattern: String.raw`^(?=\d)\d{5}$` } }, FLAT_MSG],
    ['an alternation', { state: { pattern: String.raw`^\d{5}|.*$` } }, FLAT_MSG],
    ['repeats side by side', { state: { pattern: '^a*a*a*a*a*b$' } }, FLAT_MSG],
    ['two repeats apart', { state: { pattern: String.raw`^\d+-\d+$` } }, FLAT_MSG],
    ['two bounded ranges', { state: { pattern: '^.{0,64}.{0,64}$' } }, FLAT_MSG],
    ['two optional atoms', { state: { pattern: '^a?a?$' } }, FLAT_MSG],
    [
      'optional Unicode code-point escapes',
      { state: { pattern: String.raw`^\u{61}?\u{61}?a$` } },
      FLAT_MSG,
    ],
    ['a repeat before a long exact count', { state: { pattern: '^.*a{20000}$' } }, FLAT_MSG],
    ['a repeat before a literal', { state: { pattern: String.raw`^\w+!$` } }, FLAT_MSG],
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

  it('sound rules on a header slot pass', () => {
    const status = {
      oneOf: ['activated'],
      pemCertificate: { keyRef: 'carry.certKeyPem' },
    } as const;
    const step: IStepConfig = {
      ...ruled({ status }),
      headerExtractsToCarry: { status: { header: 'device-status' } },
    };
    const call = { flow: 'sms-otp', envelope: {}, steps: [step] } as const;
    const result = validateApiDirectConfig({ call, transport: NATIVE });
    expect(result).toEqual({ success: true, value: true });
  });

  it.each([
    ['one bounded range', String.raw`^\d{1,4}$`],
    ['one range of any text', '^.{1,64}$'],
    ['exact counts before a final range', String.raw`^\d{3}-\d{2,4}$`],
    ['exact counts only', String.raw`^\d{3}-\d{4}$`],
    ['an escaped quantifier before a repeat', String.raw`^\++$`],
    ['quantifier characters inside a class', '^[(+*?{}|]+$'],
    ['a lazy repeat', String.raw`^\w+?$`],
    ['an exact lazy count beside a repeat', String.raw`^a{2}?\d*$`],
    ['a final optional Unicode escape', String.raw`^\u{61}?$`],
    ['fixed escapes before a final repeat', String.raw`^\x61{2}\u0062+$`],
    ['an escaped bracket in a class', String.raw`^[\]]+$`],
  ])('a pattern with %s passes', (_label, pattern) => {
    const step = ruled({ state: { pattern } });
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

const RUN_IF_MSG = 'steps.runIf: carry and oneOf must not be empty';

describe('validateApiDirectConfig — keepExisting extract ownership', () => {
  const errorMessage =
    'steps.optionalExtractsToCarry: keepExisting must not overlap other answer slots';
  const keptStep: IStepConfig = {
    ...ruled({}),
    optionalExtractsToCarry: { target: { pointer: '/target', keepExisting: true } },
  };
  const sources: readonly (readonly [string, IStepConfig])[] = [
    [
      'a response header',
      { ...keptStep, headerExtractsToCarry: { target: { header: 'x-device-id' } } },
    ],
    [
      'a text capture',
      {
        ...keptStep,
        response: 'text',
        textCaptures: { target: { pattern: '^token=(.+)$', group: 1 } },
      },
    ],
    [
      'a form capture',
      {
        ...keptStep,
        response: 'text',
        formCapture: {
          form: 'login',
          into: 'target',
          action: 'https://bank.example/login',
          required: ['csrf'],
          forbidden: [],
          minFields: 1,
          maxFields: 4,
        },
      },
    ],
  ];

  it.each([
    ['login', runOf],
    ['resume', resumeOf],
  ] as const)('refuses a kept required slot in a %s step', (_label, inputOf) => {
    const optionalExtractsToCarry = { state: { pointer: '/state', keepExisting: true } } as const;
    const step: IStepConfig = { ...ruled({}), optionalExtractsToCarry };
    const input = inputOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage,
    });
  });

  describe.each([
    ['login', runOf],
    ['resume', resumeOf],
  ] as const)('%s answer-slot sources', (_label, inputOf) => {
    it.each(sources)('refuses a kept slot also written by %s', (_source, step) => {
      const input = { ...inputOf(step), transport: NATIVE };
      const result = validateApiDirectConfig(input);
      expect(result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage,
      });
    });

    it.each(sources)('allows a distinct kept slot beside %s', (_source, step) => {
      const distinct: IStepConfig = {
        ...step,
        optionalExtractsToCarry: { held: { pointer: '/held', keepExisting: true } },
      };
      const input = { ...inputOf(distinct), transport: NATIVE };
      const result = validateApiDirectConfig(input);
      expect(result).toEqual({ success: true, value: true });
    });
  });

  it('allows a non-writing absent text guard on a kept slot', () => {
    const step: IStepConfig = {
      ...keptStep,
      response: 'text',
      textCaptures: { target: { pattern: '^error$', group: 0, absent: true } },
    };
    const input = { ...runOf(step), transport: NATIVE };
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('allows overlapping extracts without keepExisting', () => {
    const optionalExtractsToCarry = { state: { pointer: '/state' } };
    const step: IStepConfig = { ...ruled({}), optionalExtractsToCarry };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('allows keepExisting on a distinct optional slot', () => {
    const optionalExtractsToCarry = { target: { pointer: '/target', keepExisting: true } } as const;
    const step: IStepConfig = { ...ruled({}), optionalExtractsToCarry };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});

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
const VALUE_FLAT_MSG = 'steps.preHook.valuePattern: must be a flat regex';

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

  it.each([
    ['a group', String.raw`^(\d+)+$`],
    ['two repeats', String.raw`^\d+\d+$`],
    ['a repeat before a literal', String.raw`^\d*x$`],
    ['an optional Unicode escape before a literal', String.raw`^\u{61}?b$`],
  ])('%s fails the build', (_label, valuePattern) => {
    const step = hookedStep(valuePattern);
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: VALUE_FLAT_MSG });
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
