/**
 * Carry-generator rules for an api-direct call config (N25), on login and
 * resume steps alike. An `rsa-key` generator must name at least one slot to
 * write, or the key it makes is lost.
 */

import type {
  ICarryGenerator,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether an `rsa-key` generator names no slot.
 * @param generator - Generator config.
 * @returns True when neither `keyInto` nor `spkiSha256HexInto` is set.
 */
function isTargetless(generator: ICarryGenerator): boolean {
  return generator.keyInto === undefined && generator.spkiSha256HexInto === undefined;
}

/**
 * Whether a step runs a generator that names no slot.
 * @param step - Login or resume step.
 * @returns True for a targetless generator.
 */
function hasTargetless(step: IStepConfig): boolean {
  return (step.generate ?? []).some(isTargetless);
}

/**
 * Whether any login or resume step runs a targetless generator.
 * @param input - Rule input.
 * @returns True when a generator names no slot.
 */
function hasTargetlessGenerator(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasTargetless);
}

/** Carry-generator rules, checked after the step-guard rules. */
const API_DIRECT_GENERATE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.generate: rsa-key needs keyInto or spkiSha256HexInto',
    isBroken: hasTargetlessGenerator,
  },
];

export default API_DIRECT_GENERATE_RULES;
export { API_DIRECT_GENERATE_RULES };
