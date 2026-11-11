/**
 * Validates response-integrity settings on bank defaults and all flow steps.
 */

import { isResponseIntegrity } from '../../Types/Domain/ResponseIntegrityPolicy.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether the bank default is present and malformed.
 * @param input - Bank and flow config.
 * @returns True when the default cannot be enforced.
 */
function hasBadBankIntegrity(input: IApiDirectRuleInput): boolean {
  if (input.transport === false || input.transport.responseIntegrity === undefined) return false;
  return !isResponseIntegrity(input.transport.responseIntegrity);
}

/**
 * Whether a login or resume step sets a malformed policy.
 * @param input - Bank and flow config.
 * @returns True when any step policy cannot be enforced.
 */
function hasBadStepIntegrity(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(
    (step): boolean =>
      step.responseIntegrity !== undefined && !isResponseIntegrity(step.responseIntegrity),
  );
}

const API_DIRECT_INTEGRITY_RULES: readonly IApiDirectRule[] = [
  { message: 'transport.responseIntegrity: invalid policy', isBroken: hasBadBankIntegrity },
  { message: 'steps.responseIntegrity: invalid policy', isBroken: hasBadStepIntegrity },
];

export default API_DIRECT_INTEGRITY_RULES;
export { API_DIRECT_INTEGRITY_RULES };
