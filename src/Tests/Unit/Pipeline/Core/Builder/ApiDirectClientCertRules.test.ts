/**
 * N26 — a dynamic client certificate is checked when the pipeline is built: a
 * step `clientCert` needs the headless dynamic block, whose `origin` must be
 * an exact https origin, and the block excludes a registered certificate.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The bank's headless block when it has one. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['headless'], false>;

const STEP_MSG = 'steps.clientCert: not allowed without headless.clientCert';
const ORIGIN_MSG = 'headless.clientCert.origin: must be an exact https origin';
const REGISTERED_MSG = 'headless.clientCert: not allowed with headless.requiresClientCert';

const HOST = 'https://bank.example';
const PLAIN: HeadlessBlock = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {} };
const DYNAMIC: HeadlessBlock = { ...PLAIN, clientCert: { mode: 'dynamic', origin: HOST } };

const CALL: IStepConfig = {
  name: 'register',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: {},
};

const INSTALLING: IStepConfig = {
  ...CALL,
  clientCert: { key: 'carry.certKeyPem', cert: 'carry.certPem' },
};

/**
 * Rule input whose one login step is the given step.
 * @param step - The login step.
 * @param headless - The bank's headless block, or false.
 * @returns Rule input.
 */
function runOf(step: IStepConfig, headless: HeadlessBlock | false): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless };
}

/**
 * A dynamic headless block presenting to the given origin.
 * @param origin - Declared origin.
 * @returns Headless block.
 */
function presentingTo(origin: string): HeadlessBlock {
  return { ...PLAIN, clientCert: { mode: 'dynamic', origin } };
}

/**
 * Rule input whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Rule input with a plain headless block.
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
  return {
    call: { flow: 'sms-otp', envelope: {}, steps: [CALL], persistentAuth },
    headless: PLAIN,
  };
}

describe('validateApiDirectConfig — dynamic client certificate', () => {
  it.each<[string, HeadlessBlock | false]>([
    ['no headless block', false],
    ['a headless block without clientCert', PLAIN],
  ])('a step clientCert with %s fails the build', (_label, headless) => {
    const input = runOf(INSTALLING, headless);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: STEP_MSG,
    });
  });

  it.each<[string, IStepConfig]>([
    ['a step installing the certificate', INSTALLING],
    ['a step without clientCert', CALL],
  ])('a dynamic block with %s passes', (_label, step) => {
    const input = runOf(step, DYNAMIC);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('a resume step installing the certificate needs the block too', () => {
    const input = resumeOf(INSTALLING);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: STEP_MSG });
  });

  it.each([
    'http://bank.example',
    'https://bank.example/',
    'https://bank.example/v1',
    'https://Bank.example',
    'https://bank.example:443',
    'https://user@bank.example',
    'bank.example',
    '',
  ])('origin %j fails the build', origin => {
    const headless = presentingTo(origin);
    const input = runOf(CALL, headless);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: ORIGIN_MSG });
  });

  it('an origin with an explicit non-default port passes', () => {
    const headless = presentingTo('https://bank.example:8443');
    const input = runOf(CALL, headless);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('a dynamic block with a registered certificate fails the build', () => {
    const headless: HeadlessBlock = { ...DYNAMIC, requiresClientCert: true };
    const input = runOf(CALL, headless);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: REGISTERED_MSG });
  });
});
