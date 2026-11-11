/**
 * Step rules for an api-direct call config, on login and resume steps alike.
 * Outcome rules run before warm-start checks; the remaining rules run after
 * seal rules. Each `failIfPresent` entry must be a
 * JSON pointer below the body root: a bare key would never resolve, and the
 * root would fail every answer. A `bankErrorType` needs a `failIfPresent`
 * guard or a codec, else it types an error the step never raises. Each
 * `extractRules` key must name a
 * body or header extract of its step; a `pattern` must be anchored (`^…$`)
 * and compile; `maxChars` must be an integer from 1 to 65536; `oneOf` and
 * `url` must not be empty, since an empty list would refuse every value. A `runIf` guard
 * needs a carry slot and a non-empty `oneOf`, else its step never runs.
 * A pre-hook `valuePattern` must be anchored and compile, like an
 * extract `pattern`. Both must be flat (`../FlatPattern.ts`): no group, no
 * alternation and a variable repeat on the last atom only, so a match takes
 * linear time. The `httpFailureMap` rules follow (`ApiDirectHttpFailureRules.ts`).
 */

import type {
  IExtractRule,
  IStepConfig,
} from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  allSteps,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isBadCharCap,
  isBodyPointer,
  isExtractSlot,
} from '../ApiDirectRuleInput.js';
import { API_DIRECT_OPTIONAL_EXTRACT_RULES } from '../Captures/ApiDirectOptionalExtractRules.js';
import { isBadRegex, isFlatPattern } from '../FlatPattern.js';
import { API_DIRECT_HTTP_FAILURE_RULES } from './ApiDirectHttpFailureRules.js';

/**
 * An outcome with no success codes would refuse every response.
 * @param input - Rule input.
 * @returns True when any step's outcome lists no success codes.
 */
function hasEmptySuccessCodes(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some((step): boolean => step.outcome?.successCodes.length === 0);
}

/**
 * Refuse failure-map keys that collapse to the same code at runtime.
 * @param input - Rule input.
 * @returns True when a case-insensitive outcome has colliding keys.
 */
function hasCaselessFailureMapCollision(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some((step): boolean => {
    if (step.outcome?.caseInsensitive !== true) return false;
    const keys = Object.keys(step.outcome.failureMap).map((key): string => key.toLowerCase());
    return new Set(keys).size !== keys.length;
  });
}

/** Outcome rules checked before warm-start checks. */
const API_DIRECT_OUTCOME_RULES: readonly IApiDirectRule[] = [
  { message: 'outcome.successCodes: must not be empty', isBroken: hasEmptySuccessCodes },
  {
    message: 'outcome.failureMap: duplicate keys ignoring case',
    isBroken: hasCaselessFailureMapCollision,
  },
];

/**
 * Whether a step's guard holds an entry that is not a body pointer.
 * @param step - Step config.
 * @returns True for a bad entry.
 */
function hasBadGuard(step: IStepConfig): boolean {
  return !(step.failIfPresent ?? []).every(isBodyPointer);
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

/**
 * Whether a step types a bank error it can never raise.
 * @param step - Step config.
 * @returns True for a `bankErrorType` with no guard pointer and no codec.
 */
function isIdleErrorType(step: IStepConfig): boolean {
  if (step.bankErrorType === undefined) return false;
  const pointers = step.failIfPresent ?? [];
  return pointers.length === 0 && step.codec === undefined;
}

/**
 * Whether any login or resume step types a bank error it can never raise.
 * @param input - Rule input.
 * @returns True when a `bankErrorType` has nothing to type.
 */
function hasIdleErrorType(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(isIdleErrorType);
}

/** A check on one extract rule. */
type ExtractRuleCheck = (rule: IExtractRule) => boolean;

/**
 * Whether any login or resume step has an extract rule that breaks a check.
 * @param input - Rule input.
 * @param isBad - The check.
 * @returns True when some rule breaks it.
 */
function hasBadRule(input: IApiDirectRuleInput, isBad: ExtractRuleCheck): boolean {
  const steps = allSteps(input.call);
  const rules = steps.flatMap(step => Object.values(step.extractRules ?? {}));
  return rules.some(isBad);
}

/**
 * Whether a step has a rule key that names none of its extracts.
 * @param step - Step config.
 * @returns True for a stray key.
 */
function hasStrayRuleKey(step: IStepConfig): boolean {
  const slots = Object.keys(step.extractRules ?? {});
  return !slots.every(slot => isExtractSlot(step, slot));
}

/**
 * Whether any login or resume step has a stray rule key.
 * @param input - Rule input.
 * @returns True when an `extractRules` key names no body or header extract.
 */
function hasStrayExtractRule(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(hasStrayRuleKey);
}

/**
 * Whether a rule's pattern is broken.
 * @param rule - Extract rule.
 * @returns True for a pattern that is unanchored or does not compile.
 */
function isBadPattern(rule: IExtractRule): boolean {
  if (rule.pattern === undefined) return false;
  return isBadRegex(rule.pattern);
}

/**
 * Whether a rule's pattern is not flat.
 * @param rule - Extract rule.
 * @returns True for a pattern that could backtrack.
 */
function isUnflatPattern(rule: IExtractRule): boolean {
  if (rule.pattern === undefined) return false;
  return !isFlatPattern(rule.pattern);
}

/**
 * Whether a rule's length cap is broken.
 * @param rule - Extract rule.
 * @returns True for a `maxChars` that is not an integer from 1 to 65536.
 */
function isBadMaxChars(rule: IExtractRule): boolean {
  return rule.maxChars !== undefined && isBadCharCap(rule.maxChars);
}

/**
 * Whether a rule has an empty allow-list.
 * @param rule - Extract rule.
 * @returns True for an empty `oneOf` or `url`.
 */
function hasEmptyList(rule: IExtractRule): boolean {
  return rule.oneOf?.length === 0 || rule.url?.length === 0;
}

/**
 * Whether a step's guard can never let it run.
 * @param step - Step config.
 * @returns True for a blank carry slot or an empty `oneOf`.
 */
function hasEmptyGuard(step: IStepConfig): boolean {
  const guard = step.runIf;
  if (guard === undefined) return false;
  return guard.carry.trim() === '' || guard.oneOf.length === 0;
}

/**
 * Whether any login or resume step has an empty guard.
 * @param input - Rule input.
 * @returns True when a `runIf` names no slot or no text.
 */
function hasEmptyRunIf(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(hasEmptyGuard);
}

/**
 * Whether a step's pre-hook value pattern is broken.
 * @param step - Step config.
 * @returns True for a `valuePattern` that is unanchored or does not compile.
 */
function hasBadValuePattern(step: IStepConfig): boolean {
  const pattern = step.preHook?.valuePattern;
  if (pattern === undefined) return false;
  return isBadRegex(pattern);
}

/**
 * Whether any login or resume step has a broken pre-hook value pattern.
 * @param input - Rule input.
 * @returns True when a `valuePattern` is broken.
 */
function hasBadPreHookPattern(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(hasBadValuePattern);
}

/**
 * Whether any login or resume step's pre-hook value pattern is not flat.
 * @param input - Rule input.
 * @returns True when a `valuePattern` could backtrack.
 */
function hasUnflatPreHookPattern(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some((step): boolean => {
    const pattern = step.preHook?.valuePattern;
    return pattern !== undefined && !isFlatPattern(pattern);
  });
}

/**
 * A config check that holds when any extract rule breaks `isBad`.
 * @param isBad - The check on one extract rule.
 * @returns The config check.
 */
function anyExtractRule(isBad: ExtractRuleCheck): IApiDirectRule['isBroken'] {
  return (input: IApiDirectRuleInput): boolean => hasBadRule(input, isBad);
}

/** Step rules, checked in order after the seal rules. */
const API_DIRECT_STEP_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.failIfPresent: each entry must be a JSON pointer',
    isBroken: hasBadGuardPointer,
  },
  {
    message: 'steps.bankErrorType: needs failIfPresent or a codec',
    isBroken: hasIdleErrorType,
  },
  {
    message: 'steps.extractRules: each key must name a body or header extract',
    isBroken: hasStrayExtractRule,
  },
  ...API_DIRECT_OPTIONAL_EXTRACT_RULES,
  {
    message: 'steps.extractRules.pattern: must be an anchored regex',
    isBroken: anyExtractRule(isBadPattern),
  },
  {
    message: 'steps.extractRules.pattern: must be a flat regex',
    isBroken: anyExtractRule(isUnflatPattern),
  },
  {
    message: 'steps.extractRules.maxChars: must be an integer from 1 to 65536',
    isBroken: anyExtractRule(isBadMaxChars),
  },
  {
    message: 'steps.extractRules: oneOf and url must not be empty',
    isBroken: anyExtractRule(hasEmptyList),
  },
  {
    message: 'steps.runIf: carry and oneOf must not be empty',
    isBroken: hasEmptyRunIf,
  },
  {
    message: 'steps.preHook.valuePattern: must be an anchored regex',
    isBroken: hasBadPreHookPattern,
  },
  {
    message: 'steps.preHook.valuePattern: must be a flat regex',
    isBroken: hasUnflatPreHookPattern,
  },
  ...API_DIRECT_HTTP_FAILURE_RULES,
];

export default API_DIRECT_STEP_RULES;
export { API_DIRECT_OUTCOME_RULES, API_DIRECT_STEP_RULES };
