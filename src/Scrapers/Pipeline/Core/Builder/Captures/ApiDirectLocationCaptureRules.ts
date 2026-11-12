/**
 * Handoff script capture rules for an api-direct call config. A step
 * naming `locationCapture` must read `response: 'text'`. The capture's `into`
 * must not be blank, its `userAgent` not empty, and its `url` must hold at
 * least one rule. Its slot must be fresh: no slot the step also extracts,
 * captures as text or as a form, or takes as its final URL.
 */

import type { IStepConfig } from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { anyStep, type IApiDirectRule, isExtractSlot } from '../ApiDirectRuleInput.js';

/**
 * Whether a step captures a handoff URL off an answer it reads as no text.
 * @param step - Login step.
 * @returns True for `locationCapture` on a step that is not `text`.
 */
function isCaptureOffText(step: IStepConfig): boolean {
  return step.locationCapture !== undefined && step.response !== 'text';
}

/**
 * Whether a capture names no slot, no User-Agent or no URL rule.
 * @param step - Login step.
 * @returns True for a blank `into`, an empty `userAgent` or an empty `url`.
 */
function isUnnamed(step: IStepConfig): boolean {
  const capture = step.locationCapture;
  if (capture === undefined) return false;
  return capture.into.trim() === '' || capture.userAgent === '' || capture.url.length === 0;
}

/**
 * Whether a capture's slot is one the step also writes otherwise.
 * @param step - Login step.
 * @returns True for an extract, text-capture, form-capture or final-URL slot.
 */
function isStaleSlot(step: IStepConfig): boolean {
  const into = step.locationCapture?.into;
  if (into === undefined) return false;
  if (into === step.finalUrlInto || into === step.formCapture?.into) return true;
  return isExtractSlot(step, into);
}

/** Handoff script capture rules, checked after the login-form capture rules. */
const API_DIRECT_LOCATION_CAPTURE_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.locationCapture: needs a text response', isBroken: anyStep(isCaptureOffText) },
  {
    message: 'steps.locationCapture: into, userAgent and url must not be empty',
    isBroken: anyStep(isUnnamed),
  },
  { message: 'steps.locationCapture: must be a fresh slot', isBroken: anyStep(isStaleSlot) },
];

export default API_DIRECT_LOCATION_CAPTURE_RULES;
export { API_DIRECT_LOCATION_CAPTURE_RULES };
