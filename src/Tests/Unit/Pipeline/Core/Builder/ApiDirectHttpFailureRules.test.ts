/**
 * Build rules for a step's `httpFailureMap`, on login and resume steps alike:
 * the map must not be empty, each key must be a 4xx status and each value a
 * login failure type. A 2xx-5xx status outside 4xx is not the bank answering
 * about the user's input, and Generic, Timeout, NetworkError or WafBlocked
 * would type a reply as something it is not.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const EMPTY_MSG = 'steps.httpFailureMap: must not be empty';
const ENTRY_MSG = 'steps.httpFailureMap: must map 4xx statuses to login failure types';

type StatusMap = Readonly<Record<string, ScraperErrorTypes>>;

/**
 * A login step typing the given statuses.
 * @param map - The step's `httpFailureMap`.
 * @returns Step config.
 */
function mapped(map: StatusMap): IStepConfig {
  return {
    name: 'register',
    urlTag: 'auth.bind',
    body: { shape: {} },
    extractsToCarry: {},
    httpFailureMap: map,
  };
}

/**
 * Rule input running the step as the one login step.
 * @param step - The step.
 * @returns Rule input.
 */
function runOf(step: IStepConfig): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: false };
}

/**
 * Rule input whose one resume step is the given one.
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
  const login = mapped({ '401': ScraperErrorTypes.InvalidPassword });
  return {
    call: { flow: 'sms-otp', envelope: {}, steps: [login], persistentAuth },
    headless: false,
  };
}

describe('validateApiDirectConfig — httpFailureMap', () => {
  it('refuses an empty map', () => {
    const step = mapped({});
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: EMPTY_MSG });
  });

  it.each<[string, StatusMap]>([
    ['a 5xx key', { '500': ScraperErrorTypes.InvalidPassword }],
    ['a 2xx key', { '200': ScraperErrorTypes.InvalidPassword }],
    ['a four-digit key', { '4010': ScraperErrorTypes.InvalidPassword }],
    ['a padded key', { ' 401': ScraperErrorTypes.InvalidPassword }],
    ['a Generic value', { '401': ScraperErrorTypes.Generic }],
    ['a Timeout value', { '408': ScraperErrorTypes.Timeout }],
    ['a NetworkError value', { '401': ScraperErrorTypes.NetworkError }],
    ['a WafBlocked value', { '403': ScraperErrorTypes.WafBlocked }],
    [
      'one bad entry among good ones',
      { '401': ScraperErrorTypes.InvalidPassword, '503': ScraperErrorTypes.AccountBlocked },
    ],
  ])('refuses %s', (_label, map) => {
    const step = mapped(map);
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: ENTRY_MSG,
    });
  });

  it('refuses a bad map on a resume step', () => {
    const step = mapped({ '500': ScraperErrorTypes.InvalidPassword });
    const input = resumeOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: ENTRY_MSG });
  });

  it('accepts each login failure type on a 4xx status', () => {
    const step = mapped({
      '400': ScraperErrorTypes.InvalidOtp,
      '401': ScraperErrorTypes.InvalidPassword,
      '403': ScraperErrorTypes.AccountBlocked,
      '409': ScraperErrorTypes.ChangePassword,
    });
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
