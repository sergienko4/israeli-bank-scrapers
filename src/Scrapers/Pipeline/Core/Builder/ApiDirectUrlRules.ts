/**
 * Build rules for step URLs. A raw query (N41) replaces the query template
 * rather than joining it. A carried step URL (N40), which only a GET can name
 * (`IPostStep.urlFromCarry` is `never`), reads a slot that an `extractRules`
 * `url` rule of an earlier step in the same list checked: login steps and
 * resume steps each run without the other's carry.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { anyStep, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether a step sets both a raw query and a query template.
 * @param step - Step config.
 * @returns True when both are set.
 */
function isRawWithTemplate(step: IStepConfig): boolean {
  return step.rawQuery !== undefined && step.queryTemplate !== undefined;
}

/**
 * Whether a step checks a slot with an `extractRules` `url` rule.
 * @param step - Step config.
 * @param slot - Carry slot.
 * @returns True when the slot has a url rule.
 */
function hasUrlRule(step: IStepConfig, slot: string): boolean {
  const rules = step.extractRules ?? {};
  return Object.hasOwn(rules, slot) && rules[slot].url !== undefined;
}

/**
 * Whether the step at `index` carries a URL no earlier step checked.
 * @param steps - One step list.
 * @param index - The step's index.
 * @returns True for an unchecked carried URL.
 */
function isUnruledAt(steps: readonly IStepConfig[], index: number): boolean {
  const slot = steps[index].urlFromCarry;
  if (slot === undefined) return false;
  const earlier = steps.slice(0, index);
  return !earlier.some(step => hasUrlRule(step, slot));
}

/**
 * Whether any step of one list carries an unchecked URL.
 * @param steps - One step list.
 * @returns True when one does.
 */
function hasUnruledInList(steps: readonly IStepConfig[]): boolean {
  return steps.some((_step, index) => isUnruledAt(steps, index));
}

/**
 * Whether the login or the resume steps carry an unchecked URL.
 * @param input - Rule input.
 * @returns True when either list does.
 */
function hasUnruledCarriedUrl(input: IApiDirectRuleInput): boolean {
  const resume = input.call.persistentAuth?.resumeSteps ?? [];
  return [input.call.steps, resume].some(hasUnruledInList);
}

const API_DIRECT_URL_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.rawQuery: not with queryTemplate', isBroken: anyStep(isRawWithTemplate) },
  {
    message: 'steps.urlFromCarry: slot needs an earlier url rule',
    isBroken: hasUnruledCarriedUrl,
  },
];

export default API_DIRECT_URL_RULES;
export { API_DIRECT_URL_RULES };
