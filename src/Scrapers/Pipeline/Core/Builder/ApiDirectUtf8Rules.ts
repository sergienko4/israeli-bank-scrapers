/**
 * Strict UTF-8 rule for an api-direct call config. A step's
 * `strictUtf8: false` exists only to lift the bank's `headless.strictUtf8`
 * for one call; on a bank that is not strict it overrides nothing, so it
 * fails the build instead of reading as a switch that does something.
 */

import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether a step opts out of strict UTF-8 on a bank that is not strict.
 * @param input - Rule input.
 * @returns True when any login or resume step names a dead `strictUtf8: false`.
 */
function hasDeadUtf8Override(input: IApiDirectRuleInput): boolean {
  if (input.headless !== false && input.headless.strictUtf8 === true) return false;
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.strictUtf8 === false);
}

/** The strict UTF-8 rules, appended to the transport rules. */
const API_DIRECT_UTF8_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.strictUtf8: false only overrides headless.strictUtf8',
    isBroken: hasDeadUtf8Override,
  },
];

export default API_DIRECT_UTF8_RULES;
export { API_DIRECT_UTF8_RULES };
