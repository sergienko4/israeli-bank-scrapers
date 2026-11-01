/**
 * Build rules for step URLs. A raw query (N41) replaces the query template
 * rather than joining it. A carried step URL (N40), which only a GET can name
 * (`IPostStep.urlFromCarry` is `never`), reads a slot that an earlier step in
 * the same list checked — with an `extractRules` `url` rule, or as its final
 * URL (N51), which its own redirect rules check: login steps and resume steps
 * each run without the other's carry. A final-URL slot needs a manual
 * redirect, whose rules check it, and a slot of its own.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  anyStep,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
} from './ApiDirectRuleInput.js';

/**
 * Whether a step sets both a raw query and a query template.
 * @param step - Step config.
 * @returns True when both are set.
 */
function isRawWithTemplate(step: IStepConfig): boolean {
  return step.rawQuery !== undefined && step.queryTemplate !== undefined;
}

/**
 * Whether a step sets a final-URL slot without a manual redirect.
 * @param step - Step config.
 * @returns True when the slot has no rules to pass.
 */
function isUnguardedFinal(step: IStepConfig): boolean {
  return step.finalUrlInto !== undefined && typeof step.redirect !== 'object';
}

/**
 * Whether a step's final-URL slot is blank or one it also extracts.
 * @param step - Step config.
 * @returns True when the slot is not a fresh one.
 */
function isStaleFinal(step: IStepConfig): boolean {
  const slot = step.finalUrlInto;
  if (slot === undefined) return false;
  return slot.trim() === '' || isExtractSlot(step, slot);
}

/**
 * Whether a step checks a slot: an `extractRules` `url` rule, or its final URL.
 * @param step - Step config.
 * @param slot - Carry slot.
 * @returns True when the slot is a checked URL.
 */
function hasUrlRule(step: IStepConfig, slot: string): boolean {
  if (step.finalUrlInto === slot) return true;
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
  { message: 'steps.finalUrlInto: needs a manual redirect', isBroken: anyStep(isUnguardedFinal) },
  { message: 'steps.finalUrlInto: must be a fresh slot', isBroken: anyStep(isStaleFinal) },
];

export default API_DIRECT_URL_RULES;
export { API_DIRECT_URL_RULES };
