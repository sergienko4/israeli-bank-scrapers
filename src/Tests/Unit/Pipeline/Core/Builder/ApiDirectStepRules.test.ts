/**
 * N20 — each `failIfPresent` entry must be a JSON pointer below the body root,
 * on login and resume steps alike.
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
