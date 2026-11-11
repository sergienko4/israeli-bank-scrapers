/**
 * Optional-extract ownership rules: no required or answer extract may overwrite
 * a slot the same step declares as keepExisting.
 */

import type { IStepConfig } from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { captureSlotsOf } from '../../../Mediator/ApiDirectCall/Flow/Captures/RunStep.textCapture.js';
import { anyStep, type IApiDirectRule } from '../ApiDirectRuleInput.js';

/**
 * The required and answer slots that can overwrite an optional extract.
 * @param step - Step config.
 * @returns Slot names, excluding text guards that never write carry.
 */
function answerSlotNames(step: IStepConfig): readonly string[] {
  const maps = [step.extractsToCarry, step.headerExtractsToCarry ?? {}];
  const bodyAndHeaders = maps.flatMap(Object.keys);
  const pages = [step.finalUrlInto, step.formCapture?.into, step.locationCapture?.into];
  const slots = [...bodyAndHeaders, ...captureSlotsOf(step), ...pages];
  return slots.filter((slot): slot is string => slot !== undefined);
}

/**
 * Whether another answer source can overwrite an optional slot meant to be kept.
 * @param step - Step config.
 * @returns True when another writer owns a keepExisting slot.
 */
function hasKeptSlotOverlap(step: IStepConfig): boolean {
  const optional = Object.entries(step.optionalExtractsToCarry ?? {});
  const slots = answerSlotNames(step);
  return optional.some(
    ([slot, extract]): boolean => extract.keepExisting === true && slots.includes(slot),
  );
}

/** Ownership checks run on login and durable-resume steps before any request. */
const API_DIRECT_OPTIONAL_EXTRACT_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.optionalExtractsToCarry: keepExisting must not overlap other answer slots',
    isBroken: anyStep(hasKeptSlotOverlap),
  },
];

export default API_DIRECT_OPTIONAL_EXTRACT_RULES;
export { API_DIRECT_OPTIONAL_EXTRACT_RULES };
