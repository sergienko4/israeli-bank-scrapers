/**
 * Build-time rules for the open step/URL contracts and the bank-error code
 * map on login and resume steps. The map needs code pointers, the pointers
 * need a map, a pointer must be a JSON pointer below the body root, and a map
 * needs a guard or codec to raise the bank error it types. Step names are
 * 1–64 ASCII letters or digits starting with a letter, and URL groups are
 * dot-separated name segments.
 */

import type { IStepConfig } from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { isValidWkUrlGroup } from '../../../Types/Domain/WKUrl.js';
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

/** Step-name shape: 1–64 letters or digits, first character a letter. */
const STEP_NAME_PATTERN = /^[A-Z][A-Z0-9]{0,63}$/i;

/**
 * Whether a step name breaks the shape rule.
 * @param step - Step config.
 * @returns True for a bad step name.
 */
function hasBadStepName(step: IStepConfig): boolean {
  return !STEP_NAME_PATTERN.test(step.name);
}

/**
 * Whether any login or resume step has a bad name.
 * @param input - Rule input.
 * @returns True when a `name` breaks the shape rule.
 */
function hasBadStepNameAny(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasBadStepName);
}

/**
 * Whether a URL tag breaks the group shape.
 * @param step - Step config.
 * @returns True for a bad URL group.
 */
function hasBadUrlTag(step: IStepConfig): boolean {
  return !isValidWkUrlGroup(step.urlTag);
}

/**
 * Whether any login or resume step has a bad URL tag.
 * @param input - Rule input.
 * @returns True when a `urlTag` breaks the group shape.
 */
function hasBadUrlTagAny(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(hasBadUrlTag);
}

/** The contract rules, checked with the step rules. */
const API_DIRECT_CONTRACT_RULES: readonly IApiDirectRule[] = [
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
  {
    message: 'steps.name: must be 1-64 letters or digits, starting with a letter',
    isBroken: hasBadStepNameAny,
  },
  {
    message: 'steps.urlTag: must be dot-separated letters or digits',
    isBroken: hasBadUrlTagAny,
  },
];

export default API_DIRECT_CONTRACT_RULES;
