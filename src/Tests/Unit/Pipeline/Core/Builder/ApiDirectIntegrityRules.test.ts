/**
 * Integrity policies must be valid and backed by the native transport.
 */

import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IResponseIntegrity } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

const STEP: IStepConfig = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  method: 'GET',
  extractsToCarry: {},
};
const BANK = {
  identityBase: 'https://bank.example/',
  graphql: 'https://bank.example/graphql',
  paths: {},
  nativeFetch: true,
} as const;

/**
 * Creates a minimal builder input for the selected policies.
 * @param bank - Optional bank policy.
 * @param step - Optional step policy.
 * @returns API-direct builder input.
 */
function input(bank?: IResponseIntegrity, step?: IResponseIntegrity): IApiDirectRuleInput {
  return {
    transport: { ...BANK, responseIntegrity: bank },
    call: {
      flow: 'sms-otp',
      envelope: {},
      steps: [{ ...STEP, responseIntegrity: step }],
    },
  };
}

describe('API-direct response integrity rules', () => {
  it('accepts absent and valid bank and step policies', () => {
    const policy = { maxBytes: 1, sha256: 'a'.repeat(64) };
    const absentInput = input();
    const validInput = input({ maxBytes: 8_388_608 }, policy);
    const absent = validateApiDirectConfig(absentInput);
    const valid = validateApiDirectConfig(validInput);
    expect(absent).toMatchObject({ success: true });
    expect(valid).toMatchObject({ success: true });
  });

  it.each([
    { maxBytes: 0 },
    { maxBytes: 1.5 },
    { maxBytes: Number.NaN },
    { maxBytes: 8_388_609 },
    { maxBytes: 10, sha256: 'A'.repeat(64) },
  ])('refuses an invalid bank policy', policy => {
    const configured = input(policy);
    const result = validateApiDirectConfig(configured);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'transport.responseIntegrity: invalid policy',
    });
  });

  it('refuses an invalid step policy before dispatch', () => {
    const configured = input(undefined, { maxBytes: 0 });
    const result = validateApiDirectConfig(configured);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.responseIntegrity: invalid policy',
    });
  });

  it('refuses a policy for a non-native bank', () => {
    const configured = input({ maxBytes: 32 }, { maxBytes: 16 });
    const headless = { ...BANK, nativeFetch: false, responseIntegrity: { maxBytes: 32 } };
    const result = validateApiDirectConfig({ ...configured, transport: headless });
    expect(result).toMatchObject({ success: false });
  });
});
