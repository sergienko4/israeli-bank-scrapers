/**
 * Build rules for step URLs. A raw query replaces the query template
 * rather than joining it. A carried step URL, which only a GET can name
 * (`IPostStep.urlFromCarry` is `never`), reads a slot whose earlier writers in
 * the same list checked — with an `extractRules` `url` rule, as its final
 * URL, which its own redirect rules check, or as its handoff script's
 * URL, which its capture's `url` rules check, as an SDK reference, or as a
 * checked URL path map. Login steps and resume steps each run without the
 * other's carry. A final-URL slot needs a manual redirect and its own slot.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { structuredSlotsOf } from '../../Mediator/ApiDirectCall/Flow/Captures/RunStep.structuredCapture.js';
import { allowedRulesOf } from '../../Mediator/ApiDirectCall/Flow/RunStep.carriedUrlRules.js';
import {
  answerCapturesOf,
  anyStep,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
  resumeStepsOf,
} from './ApiDirectRuleInput.js';

const CHECKED_DERIVATIONS: ReadonlySet<string> = new Set(['url-path-map', 'url-compose']);

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
 * The direct carry targets a step can name, including its pre-hook.
 * @param step - Step config.
 * @returns Direct slots, excluding unset targets.
 */
function directSlotsOf(step: IStepConfig): readonly string[] {
  return [
    step.finalUrlInto,
    step.formCapture?.into,
    step.locationCapture?.into,
    step.classify?.into,
    step.preHook?.intoCarryField,
  ].filter((slot): slot is string => slot !== undefined);
}

/**
 * Whether a step may write a carry slot, including derived carry and pre-hooks.
 * @param step - Step config.
 * @param slot - Carry slot.
 * @returns True when the step may set the slot.
 */
function writesSlot(step: IStepConfig, slot: string): boolean {
  if (directSlotsOf(step).includes(slot)) return true;
  if (structuredSlotsOf(step).includes(slot)) return true;
  const derived = step.deriveCarry ?? [];
  if (derived.some((entry): boolean => entry.into === slot)) return true;
  const captures = step.classify === undefined ? [] : answerCapturesOf(step.classify);
  return captures.some(([written]): boolean => written === slot) || isExtractSlot(step, slot);
}

/**
 * Whether a step checks every derived value and declares a URL rule.
 * @param step - Step config.
 * @param slot - Carry slot.
 * @returns True when the slot is a checked URL.
 */
function hasUrlRule(step: IStepConfig, slot: string): boolean {
  const derived = step.deriveCarry ?? [];
  if (
    derived.some((entry): boolean => {
      return entry.into === slot && !CHECKED_DERIVATIONS.has(entry.op?.kind ?? '');
    })
  )
    return false;
  return allowedRulesOf(step, slot).length > 0;
}

/**
 * Whether the step at `index` may carry an unchecked URL. Optional and
 * guarded steps can leave an earlier value in place, so every possible writer
 * must check its value; a pre-hook on the consumer runs before its URL resolves.
 * @param steps - One step list.
 * @param index - The step's index.
 * @returns True for an unchecked carried URL.
 */
function isUnruledAt(steps: readonly IStepConfig[], index: number): boolean {
  const slot = steps[index].urlFromCarry;
  if (slot === undefined) return false;
  if (steps[index].preHook?.intoCarryField === slot) return true;
  const writers = steps.slice(0, index).filter((step): boolean => writesSlot(step, slot));
  return writers.length === 0 || writers.some((step): boolean => !hasUrlRule(step, slot));
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
  const resume = resumeStepsOf(input.call);
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
