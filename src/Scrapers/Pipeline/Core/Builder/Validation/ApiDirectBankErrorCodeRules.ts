/**
 * Build-time rules for the bank-error code map on login and resume steps:
 * the map needs code pointers, the pointers need a map, a pointer must be a
 * JSON pointer below the body root, and a map needs a guard or codec to raise
 * the bank error it types.
 */

import type { IStepConfig } from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  allSteps,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isBodyPointer,
} from '../ApiDirectRuleInput.js';

/**
 * Whether a step has a code pointer that is not a body pointer.
 * @param step - Step config.
 * @returns True for a bad code pointer.
 */
function hasBadCodePointer(step: IStepConfig): boolean {
  return !(step.bankErrorCodePointers ?? []).every(isBodyPointer);
}

/**
 * Whether any login or resume step has a bad code pointer.
 * @param input - Rule input.
 * @returns True when a `bankErrorCodePointers` entry is not a body pointer.
 */
function hasBadCodePointerAny(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasBadCodePointer);
}

/**
 * Whether a step maps codes without naming where to read them.
 * @param step - Step config.
 * @returns True for a map with no code pointers.
 */
function hasMapWithoutPointers(step: IStepConfig): boolean {
  const isMapSet = step.bankErrorTypeByCode !== undefined;
  return isMapSet && (step.bankErrorCodePointers ?? []).length === 0;
}

/**
 * Whether any login or resume step maps codes without code pointers.
 * @param input - Rule input.
 * @returns True when a `bankErrorTypeByCode` has no pointers.
 */
function hasMapWithoutPointersAny(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasMapWithoutPointers);
}

/**
 * Whether a step names code pointers without a code map.
 * @param step - Step config.
 * @returns True for pointers with no map.
 */
function hasPointersWithoutMap(step: IStepConfig): boolean {
  const isPointersSet = step.bankErrorCodePointers !== undefined;
  return isPointersSet && step.bankErrorTypeByCode === undefined;
}

/**
 * Whether any login or resume step names code pointers without a map.
 * @param input - Rule input.
 * @returns True when `bankErrorCodePointers` has no map.
 */
function hasPointersWithoutMapAny(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasPointersWithoutMap);
}

/**
 * Whether a step maps codes but has no guard or codec to raise a bank error.
 * @param step - Step config.
 * @returns True for an idle code map.
 */
function isIdleCodeMap(step: IStepConfig): boolean {
  if (step.bankErrorTypeByCode === undefined) return false;
  const pointers = step.failIfPresent ?? [];
  return pointers.length === 0 && step.codec === undefined;
}

/**
 * Whether any login or resume step maps codes with nothing to raise one.
 * @param input - Rule input.
 * @returns True when a `bankErrorTypeByCode` has no guard or codec.
 */
function hasIdleCodeMap(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(isIdleCodeMap);
}

/** The bank-error code-map rules, checked with the step rules. */
const API_DIRECT_BANK_ERROR_CODE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.bankErrorCodePointers: each entry must be a JSON pointer',
    isBroken: hasBadCodePointerAny,
  },
  {
    message: 'steps.bankErrorTypeByCode: needs bankErrorCodePointers',
    isBroken: hasMapWithoutPointersAny,
  },
  {
    message: 'steps.bankErrorCodePointers: needs bankErrorTypeByCode',
    isBroken: hasPointersWithoutMapAny,
  },
  {
    message: 'steps.bankErrorTypeByCode: needs failIfPresent or a codec',
    isBroken: hasIdleCodeMap,
  },
];

export default API_DIRECT_BANK_ERROR_CODE_RULES;
