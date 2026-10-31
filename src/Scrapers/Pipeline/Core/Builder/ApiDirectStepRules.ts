/**
 * Step rules for an api-direct call config, checked after the seal rules, on
 * login and resume steps alike. Each `failIfPresent` entry (N20) must be a
 * JSON pointer below the body root: a bare key would never resolve, and the
 * root would fail every answer. Each `extractRules` key (N18) must name a body
 * extract of its step; a `pattern` must be anchored (`^…$`) and compile;
 * `maxChars` must be an integer from 1 to 65536; `oneOf` and `url` must not
 * be empty, since an empty list would refuse every value. A `runIf` guard
 * (N14) needs a carry slot and a non-empty `oneOf`, else its step never runs.
 */

import type {
  IExtractRule,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
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

const MAX_RULE_CHARS = 65536;

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
 * Whether a step has a rule key that names none of its body extracts.
 * @param step - Step config.
 * @returns True for a stray key.
 */
function hasStrayRuleKey(step: IStepConfig): boolean {
  const optional = step.optionalExtractsToCarry ?? {};
  const slots = Object.keys(step.extractRules ?? {});
  return !slots.every(
    slot => Object.hasOwn(step.extractsToCarry, slot) || Object.hasOwn(optional, slot),
  );
}

/**
 * Whether any login or resume step has a stray rule key.
 * @param input - Rule input.
 * @returns True when an `extractRules` key names no body extract.
 */
function hasStrayExtractRule(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(hasStrayRuleKey);
}

/**
 * Whether a regex source compiles with the unicode flag.
 * @param pattern - Regex source.
 * @returns True when it compiles.
 */
function isCompilable(pattern: string): boolean {
  try {
    const compiled = new RegExp(pattern, 'u');
    return compiled instanceof RegExp;
  } catch {
    return false;
  }
}

/**
 * Whether a rule's pattern is broken.
 * @param rule - Extract rule.
 * @returns True for a pattern that is unanchored or does not compile.
 */
function isBadPattern(rule: IExtractRule): boolean {
  if (rule.pattern === undefined) return false;
  const isAnchored = rule.pattern.startsWith('^') && rule.pattern.endsWith('$');
  return !isAnchored || !isCompilable(rule.pattern);
}

/**
 * Whether a rule's length cap is broken.
 * @param rule - Extract rule.
 * @returns True for a `maxChars` that is not an integer from 1 to 65536.
 */
function isBadMaxChars(rule: IExtractRule): boolean {
  const max = rule.maxChars;
  if (max === undefined) return false;
  return !Number.isInteger(max) || max < 1 || max > MAX_RULE_CHARS;
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
    message: 'steps.extractRules: each key must name a body extract',
    isBroken: hasStrayExtractRule,
  },
  {
    message: 'steps.extractRules.pattern: must be an anchored regex',
    isBroken: anyExtractRule(isBadPattern),
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
];

export default API_DIRECT_STEP_RULES;
export { API_DIRECT_STEP_RULES };
