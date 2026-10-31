/**
 * Step-guard rules for an api-direct call config, checked after the seal
 * rules. Each `failIfPresent` entry (N20) must be a JSON pointer below the
 * body root, on login and resume steps alike: a bare key would never resolve,
 * and the root would fail every answer.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether a guard entry is a pointer below the body root.
 * @param pointer - One `failIfPresent` entry.
 * @returns True for `/` followed by at least one character.
 */
function isBodyPointer(pointer: string): boolean {
  return pointer.startsWith('/') && pointer.length > 1;
}

/**
 * Whether a step's guard holds an entry that is not a body pointer.
 * @param step - Step config.
 * @returns True for a bad entry.
 */
function hasBadGuard(step: IStepConfig): boolean {
  const pointers = step.failIfPresent ?? [];
  return !pointers.every(isBodyPointer);
}

/**
 * Whether any login or resume step has a bad guard entry.
 * @param input - Rule input.
 * @returns True when a `failIfPresent` entry is not a body pointer.
 */
function hasBadGuardPointer(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(hasBadGuard);
}

/** Step-guard rules, checked in order after the seal rules. */
const API_DIRECT_STEP_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.failIfPresent: each entry must be a JSON pointer',
    isBroken: hasBadGuardPointer,
  },
];

export default API_DIRECT_STEP_RULES;
export { API_DIRECT_STEP_RULES };
