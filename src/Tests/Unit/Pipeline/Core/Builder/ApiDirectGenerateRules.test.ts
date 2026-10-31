/**
 * N25 — a step's carry generators are checked when the pipeline is built:
 * an `rsa-key` generator must name at least one target slot.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  ICarryGenerator,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const TARGET_MSG = 'steps.generate: rsa-key needs keyInto or spkiSha256HexInto';

/**
 * Rule input whose one login step runs the given generator.
 * @param generator - The step's generator.
 * @returns Rule input.
 */
function runOf(generator: ICarryGenerator): IApiDirectRuleInput {
  const step: IStepConfig = {
    name: 'register',
    urlTag: 'auth.bind',
    generate: [generator],
    body: { shape: {} },
    extractsToCarry: {},
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: false };
}

describe('validateApiDirectConfig — carry generators', () => {
  it('an rsa-key generator with no target fails the build', () => {
    const input = runOf({ kind: 'rsa-key', bits: 2048 });
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: TARGET_MSG,
    });
  });

  it.each<[string, ICarryGenerator]>([
    ['keyInto', { kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' }],
    ['spkiSha256HexInto', { kind: 'rsa-key', bits: 2048, spkiSha256HexInto: 'deviceId' }],
  ])('an rsa-key generator naming %s passes', (_label, generator) => {
    const input = runOf(generator);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
