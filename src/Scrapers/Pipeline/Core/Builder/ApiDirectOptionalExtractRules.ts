/**
 * Optional-extract ownership rules: a required extract must not overwrite
 * a slot the same step declares as keepExisting.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { anyStep, type IApiDirectRule } from './ApiDirectRuleInput.js';

/**
 * Whether a required extract can overwrite an optional slot meant to be kept.
 * @param step - Step config.
 * @returns True when both extract maps own a keepExisting slot.
 */
function hasKeptRequiredExtract(step: IStepConfig): boolean {
  const optional = Object.entries(step.optionalExtractsToCarry ?? {});
  return optional.some(
    ([slot, extract]): boolean =>
      extract.keepExisting === true && Object.hasOwn(step.extractsToCarry, slot),
  );
}

/** Ownership checks run on login and durable-resume steps before any request. */
const API_DIRECT_OPTIONAL_EXTRACT_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.optionalExtractsToCarry: keepExisting must not overlap extractsToCarry',
    isBroken: anyStep(hasKeptRequiredExtract),
  },
];

export default API_DIRECT_OPTIONAL_EXTRACT_RULES;
export { API_DIRECT_OPTIONAL_EXTRACT_RULES };
