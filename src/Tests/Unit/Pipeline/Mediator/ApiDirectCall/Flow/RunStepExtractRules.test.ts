/**
 * N18 — per-slot extract rules, run on the raw value once the step's body is
 * extracted: `type` first, then `transform`, then `maxChars` (8192 when unset
 * for text), `oneOf`, an anchored `pattern` and `url` rules. A number is
 * stringified only when a text check runs. An optional slot whose pointer is
 * unresolved, `null` or `''` skips its rule. N27 — a header-extract slot is
 * ruled like a body one. The carry comes back with each ruled slot holding
 * its checked value. A failure is `<step> extract <slot> invalid` and names
 * no value.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IExtractRule,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { applyExtractRules } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.extractRules.js';
import { extractOptional } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.optional.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const STEP_URL = 'https://bank.example/authenticate/verify';
const SECRET = 'tok_9f8e7d6c5b4a';
const PORTAL = [{ origin: 'https://bank.example', paths: ['/portal/home'] }];
const LOWER_STATE: IExtractRule = { type: 'string', transform: 'lower', oneOf: ['logonotp'] };
const RULE_SCOPE: ITemplateScope = {
  carry: {},
  creds: {},
  config: { flow: 'sms-otp', envelope: {}, steps: [] },
};

/**
 * A step reading `slot` as a required extract, ruled by `rule`.
 * @param rule - Extract rule.
 * @returns Step config.
 */
function requiredStep(rule: IExtractRule): IStepConfig {
  return {
    name: 'bind',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: { slot: '/slot' },
    extractRules: { slot: rule },
  };
}

/**
 * A step reading `slot` as an optional extract, ruled by `rule`.
 * @param rule - Extract rule.
 * @returns Step config.
 */
function optionalStep(rule: IExtractRule): IStepConfig {
  return {
    name: 'bind',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: {},
    optionalExtractsToCarry: { slot: { pointer: '/slot' } },
    extractRules: { slot: rule },
  };
}

/**
 * A step reading `slot` from the `device-status` header, ruled by `rule`.
 * @param rule - Extract rule.
 * @returns Step config.
 */
function headerStep(rule: IExtractRule): IStepConfig {
  return {
    name: 'bind',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: {},
    headerExtractsToCarry: { slot: { header: 'device-status' } },
    extractRules: { slot: rule },
  };
}

/**
 * Apply the rules of a required-slot step to one extracted value.
 * @param rule - Extract rule.
 * @param value - The extracted value.
 * @returns The ruled slots, or a failure.
 */
function ruleRequired(rule: IExtractRule, value: JsonValue): unknown {
  const step = requiredStep(rule);
  return applyExtractRules({
    step,
    resp: { slot: value },
    carry: { slot: value },
    stepUrl: STEP_URL,
    scope: RULE_SCOPE,
  });
}

/** One value a rule keeps, and the value the slot then holds. */
interface IKeepCase {
  readonly label: string;
  readonly rule: IExtractRule;
  readonly value: JsonValue;
  readonly kept: JsonValue;
}

/** Expected failure for a value its rule refuses. */
const INVALID = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'bind extract slot invalid',
};

/** Expected failure for the flow's refused state. */
const INVALID_STATE = { ...INVALID, errorMessage: 'bind extract state invalid' };

describe('applyExtractRules — required slots', () => {
  const absolute = 'https://bank.example/Portal/Home';
  it.each<IKeepCase>([
    { label: 'a string of type string', rule: { type: 'string' }, value: 'x', kept: 'x' },
    { label: 'a number of type number', rule: { type: 'number' }, value: 7, kept: 7 },
    { label: 'a record of type object', rule: { type: 'object' }, value: { a: 1 }, kept: { a: 1 } },
    { label: 'a list of type array', rule: { type: 'array' }, value: [1], kept: [1] },
    { label: 'a lower-cased state', rule: LOWER_STATE, value: 'LogonOTP', kept: 'logonotp' },
    {
      label: 'a number stringified for a pattern',
      rule: { pattern: String.raw`^\d{1,4}$` },
      value: 42,
      kept: '42',
    },
    {
      label: 'a relative URL on an allowed path',
      rule: { url: PORTAL },
      value: '/portal/home',
      kept: '/portal/home',
    },
    { label: 'an absolute allowed URL', rule: { url: PORTAL }, value: absolute, kept: absolute },
    { label: 'text within maxChars', rule: { maxChars: 3 }, value: 'abc', kept: 'abc' },
  ])('keeps $label', ({ rule, value, kept }) => {
    const ruled = ruleRequired(rule, value);
    expect(ruled).toEqual({ success: true, value: { slot: kept } });
  });

  it.each<[string, IExtractRule, JsonValue]>([
    ['a number where a string is due', { type: 'string' }, 7],
    ['a numeric text where a number is due', { type: 'number' }, '7'],
    ['a list where a record is due', { type: 'object' }, [1]],
    ['null where a record is due', { type: 'object' }, null],
    ['a record where a list is due', { type: 'array' }, { a: 1 }],
    ['a state outside oneOf', LOWER_STATE, SECRET],
    ['a number past the pattern', { pattern: String.raw`^\d{1,4}$` }, 12345],
    ['a record under a text check', { pattern: '^.*$' }, { a: SECRET }],
    ['a boolean under a text check', { oneOf: ['true'] }, true],
    ['a foreign host', { url: PORTAL }, `https://evil.example/portal/home?t=${SECRET}`],
    ['a protocol-relative foreign host', { url: PORTAL }, '//evil.example/portal/home'],
    ['plain http', { url: PORTAL }, 'http://bank.example/portal/home'],
    ['a fragment', { url: PORTAL }, '/portal/home#x'],
    ['a path off the list', { url: PORTAL }, '/portal/other'],
    ['text over maxChars', { maxChars: 3 }, 'abcd'],
    ['text over the default 8192 chars', { type: 'string' }, 'x'.repeat(8193)],
  ])('fails %s, naming no value', (_label, rule, value) => {
    const ruled = ruleRequired(rule, value);
    expect(ruled).toMatchObject(INVALID);
    const text = JSON.stringify(ruled);
    expect(text).not.toContain(SECRET);
  });

  it('passes the carry through on a step without rules', () => {
    const plain: IStepConfig = {
      name: 'bind',
      urlTag: WARM_STEP_TAG,
      body: { shape: {} },
      extractsToCarry: { slot: '/slot' },
    };
    const carry = { slot: 7, other: 'x' };
    const ruled = applyExtractRules({
      step: plain,
      resp: {},
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toEqual({ success: true, value: carry });
  });

  it('keeps the unruled slots beside a ruled one', () => {
    const step = requiredStep(LOWER_STATE);
    const carry = { slot: 'LogonOTP', other: 'Kept' };
    const ruled = applyExtractRules({
      step,
      resp: {},
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toEqual({ success: true, value: { slot: 'logonotp', other: 'Kept' } });
  });
});

describe('applyExtractRules — optional slots', () => {
  it.each<[string, JsonValue]>([
    ['an absent field', {}],
    ['a null field', { slot: null }],
    ['an empty field', { slot: '' }],
  ])('skips the rule for %s', (_label, resp) => {
    const step = optionalStep(LOWER_STATE);
    const carry = extractOptional(resp, step, RULE_SCOPE.carry);
    const ruled = applyExtractRules({
      step,
      resp,
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toEqual({ success: true, value: {} });
  });

  it.each<[string, JsonValue]>([
    ['a record', { state: 'logonotp' }],
    ['a number', 0],
    ['false', false],
  ])('fails a present %s under a string rule', (_label, value) => {
    const step = optionalStep(LOWER_STATE);
    const ruled = applyExtractRules({
      step,
      resp: { slot: value },
      carry: { slot: value },
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toMatchObject(INVALID);
  });

  it('writes the transformed value of a present slot', () => {
    const step = optionalStep(LOWER_STATE);
    const resp = { slot: 'LOGONOTP' };
    const carry = extractOptional(resp, step, RULE_SCOPE.carry);
    const ruled = applyExtractRules({
      step,
      resp,
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toEqual({ success: true, value: { slot: 'logonotp' } });
  });
});

describe('applyExtractRules — header slots', () => {
  const activated: IExtractRule = { oneOf: ['activated'] };

  it('fails a header slot outside oneOf, naming no value', () => {
    const step = headerStep(activated);
    const carry = { slot: SECRET };
    const ruled = applyExtractRules({
      step,
      resp: {},
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toMatchObject(INVALID);
    const text = JSON.stringify(ruled);
    expect(text).not.toContain(SECRET);
  });

  it('keeps the transformed value of a header slot its rule allows', () => {
    const step = headerStep({ transform: 'lower', oneOf: ['activated'] });
    const carry = { slot: 'Activated' };
    const ruled = applyExtractRules({
      step,
      resp: {},
      carry,
      stepUrl: STEP_URL,
      scope: RULE_SCOPE,
    });
    expect(ruled).toEqual({ success: true, value: { slot: 'activated' } });
  });
});

describe('SmsOtpFlow with extract rules', () => {
  const bindStep: IStepConfig = {
    name: 'bind',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: {},
    optionalExtractsToCarry: { state: { pointer: '/state' } },
    extractRules: { state: LOWER_STATE },
  };
  const loginStep: IStepConfig = {
    name: 'login',
    urlTag: WARM_STEP_TAG,
    body: { shape: { state: { $ref: 'carry.state' }, otp: { $ref: 'carry.otp' } } },
    extractsToCarry: { token: '/token' },
    preHook: { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otp' },
  };
  const config: IApiDirectCallConfig = {
    flow: 'sms-otp',
    envelope: {},
    steps: [bindStep, loginStep],
  };

  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  /**
   * Run the two-step flow with a counting OTP retriever.
   * @param state - The state the bank answers the first step with.
   * @returns The flow result, the requests sent and the retriever calls.
   */
  async function runWith(
    state: JsonValue,
  ): Promise<{ result: unknown; captures: IApiPostCapture[]; calls: number }> {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ state }), succeed({ token: 'session-token' })];
    const bus = makeStubMediator({ responses, captures });
    let calls = 0;
    /**
     * Count the call and deliver a code.
     * @returns The delivered code.
     */
    const otpCodeRetriever = (): Promise<string> => {
      calls += 1;
      return Promise.resolve('12345');
    };
    const creds = { otpCodeRetriever };
    const result = await runSmsOtpFlow({ config, bus, creds, companyId: HINT });
    return { result, captures, calls };
  }

  it('echoes the lower-cased state into the next step', async () => {
    const run = await runWith('LogonOTP');
    expect(run.result).toMatchObject({ success: true });
    expect(run.captures[1].body).toMatchObject({ state: 'logonotp' });
  });

  it('fails before the retriever is called when the state is not text', async () => {
    const run = await runWith(0);
    expect(run.result).toMatchObject(INVALID_STATE);
    expect(run.calls).toBe(0);
    expect(run.captures).toHaveLength(1);
  });
});
