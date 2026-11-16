/**
 * Open step/URL contracts: a bank can add a step name and a WK URL group
 * without editing `StepNames.ts` or `WKUrl.ts`. The build validates the shape
 * at registration: names are 1–64 ASCII letters or digits starting with a
 * letter, and URL groups are dot-separated name segments.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  registerWkUrl,
  resetWkRegistryForTest,
  resolveWkUrl,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';

const BAD_NAME = 'steps.name: must be 1-64 letters or digits, starting with a letter';
const BAD_URL = 'steps.urlTag: must be dot-separated letters or digits';

/**
 * A minimal POST step with the given name and URL group.
 * @param name - Step name.
 * @param urlTag - WK URL group.
 * @returns Step config.
 */
function stepOf(name: string, urlTag: string): IStepConfig {
  return { name, urlTag, body: { shape: {} }, extractsToCarry: {} };
}

/**
 * Rule input running the steps as one login flow.
 * @param steps - Login steps.
 * @returns Rule input.
 */
function runOf(steps: readonly IStepConfig[]): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps }, transport: false };
}

describe('validateApiDirectConfig — open step and URL names', () => {
  afterEach(() => {
    resetWkRegistryForTest();
  });

  it('accepts a synthetic step and URL group without editing a shared union', () => {
    const step = stepOf('syntheticStep', 'synthetic.group');
    const input = runOf([step]);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('seeds and resolves a new typed transport group whose name starts with http', () => {
    const group = 'http.login';
    const url = 'https://bank.example/login';
    const transport = {
      identityBase: 'https://bank.example',
      graphql: 'https://bank.example/graphql',
      paths: { [group]: url },
    };
    const step = stepOf('syntheticStep', group);
    const input = {
      call: { flow: 'sms-otp' as const, envelope: {}, steps: [step] },
      transport,
    } satisfies IApiDirectRuleInput;
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });

    registerWkUrl(group, CompanyTypes.OneZero, url);
    const resolved = resolveWkUrl(group, CompanyTypes.OneZero);
    expect(resolved).toEqual({ success: true, value: url });
  });

  it('rejects a malformed transport-only group before registering', () => {
    expect(() => {
      registerWkUrl('bad group', CompanyTypes.OneZero, 'https://bank.example/login');
    }).toThrow(/invalid WK url group/);
  });

  it.each([
    ['a space', 'bad name'],
    ['a leading digit', '1step'],
    ['a 65-character name', `a${'b'.repeat(64)}`],
  ])('rejects a step name with %s', (_label, name) => {
    const input = runOf([stepOf(name, 'auth.login')]);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: BAD_NAME });
  });

  it.each([
    ['an empty group', ''],
    ['a group with a space', 'auth login'],
    ['a group with a trailing dot', 'auth.'],
  ])('rejects a URL group with %s', (_label, urlTag) => {
    const input = runOf([stepOf('login', urlTag)]);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: BAD_URL });
  });
});
