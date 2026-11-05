/**
 * Login-form capture rules for an api-direct call config (N37). A step naming
 * `formCapture` must read `response: 'text'`. The capture's `form` and `into`
 * must not be empty; its `action` must be an absolute https URL written as the
 * URL API writes it, since the form's action must equal it exactly; its field
 * counts must be integers with 1 <= minFields <= maxFields; its `required` and
 * `forbidden` names must be form field names and share none.
 */

import type {
  IFormCapture,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { FORM_FIELD_NAME } from '../../Mediator/ApiDirectCall/Flow/RunStep.formFields.js';
import { anyStep, type IApiDirectRule } from './ApiDirectRuleInput.js';

/** A check on one form capture. */
type CaptureCheck = (capture: IFormCapture) => boolean;

/**
 * A rule check over the form capture of every login and resume step.
 * @param isBad - Capture check.
 * @returns True when any capture fails it.
 */
function anyCapture(isBad: CaptureCheck): IApiDirectRule['isBroken'] {
  return anyStep((step): boolean => step.formCapture !== undefined && isBad(step.formCapture));
}

/**
 * Whether a step captures a form off an answer it reads as no text.
 * @param step - Login step.
 * @returns True for `formCapture` on a step that is not `text`.
 */
function isCaptureOffText(step: IStepConfig): boolean {
  return step.formCapture !== undefined && step.response !== 'text';
}

/**
 * Whether a capture names no form or no slot.
 * @param capture - Form capture.
 * @returns True for an empty `form` or `into`.
 */
function isUnnamed(capture: IFormCapture): boolean {
  return capture.form === '' || capture.into === '';
}

/**
 * Whether a capture's action is not an absolute https URL as the URL API
 * writes it.
 * @param capture - Form capture.
 * @returns True for a relative, non-https or rewritten action.
 */
function isBadAction(capture: IFormCapture): boolean {
  if (!URL.canParse(capture.action)) return true;
  const url = new URL(capture.action);
  return url.protocol !== 'https:' || url.href !== capture.action;
}

/**
 * Whether a capture's field counts are out of order.
 * @param capture - Form capture.
 * @returns True unless both are integers with 1 <= minFields <= maxFields.
 */
function isBadCount(capture: IFormCapture): boolean {
  const { minFields, maxFields } = capture;
  if (!Number.isInteger(minFields) || !Number.isInteger(maxFields)) return true;
  return minFields < 1 || maxFields < minFields;
}

/**
 * Whether a capture's names are not field names, or are both required and
 * forbidden.
 * @param capture - Form capture.
 * @returns True for an invalid name or a name in both lists.
 */
function isBadNames(capture: IFormCapture): boolean {
  const names = [...capture.required, ...capture.forbidden];
  if (!names.every((name): boolean => FORM_FIELD_NAME.test(name))) return true;
  return capture.required.some((name): boolean => capture.forbidden.includes(name));
}

/** Login-form capture rules, checked after the text rules. */
const API_DIRECT_FORM_CAPTURE_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.formCapture: needs a text response', isBroken: anyStep(isCaptureOffText) },
  {
    message: 'steps.formCapture: form and into must not be empty',
    isBroken: anyCapture(isUnnamed),
  },
  {
    message: 'steps.formCapture.action: must be an absolute https URL',
    isBroken: anyCapture(isBadAction),
  },
  {
    message: 'steps.formCapture: needs integers 1 <= minFields <= maxFields',
    isBroken: anyCapture(isBadCount),
  },
  {
    message: 'steps.formCapture: field names must be valid and disjoint',
    isBroken: anyCapture(isBadNames),
  },
];

export default API_DIRECT_FORM_CAPTURE_RULES;
export { API_DIRECT_FORM_CAPTURE_RULES };
