/**
 * Checks structured capture configuration before the first request.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { structuredSlotsOf } from '../../Mediator/ApiDirectCall/Flow/Captures/RunStep.structuredCapture.js';
import { isJwtClaimsCaptureValid } from './ApiDirectJwtCaptureValidation.js';
import {
  answerCapturesOf,
  anyStep,
  type IApiDirectRule,
  isExtractSlot,
} from './ApiDirectRuleInput.js';
import { isScriptJsonCaptureValid } from './ApiDirectScriptJsonValidation.js';
import { areSdkUrlRulesValid } from './ApiDirectStructuredUrlValidation.js';
import { generatedSlots } from './ApiDirectWarmBundleRules.js';

/**
 * Validates an SDK reference capture's URL rules.
 * @param capture - Untrusted capture configuration.
 * @returns True for a usable allowlist.
 */
function isSdkCaptureValid(capture: object): boolean {
  const url: unknown = Reflect.get(capture, 'url');
  return areSdkUrlRulesValid(url);
}

/** Per-kind validation after the shared output-slot check. */
const CAPTURE_CHECKS: Readonly<Record<string, (capture: object) => boolean>> = {
  'sdk-reference': isSdkCaptureValid,
  'script-json': isScriptJsonCaptureValid,
  'jwt-claims': isJwtClaimsCaptureValid,
};

/**
 * Whether the capture cannot run on the selected response.
 * @param step - Step configuration.
 * @returns True when the capture needs a text response.
 */
function isOffText(step: IStepConfig): boolean {
  const capture: unknown = step.structuredCapture;
  if (typeof capture !== 'object' || capture === null) return false;
  return Reflect.get(capture, 'kind') !== 'jwt-claims' && step.response !== 'text';
}

/**
 * Whether the capture lacks its required configuration.
 * @param step - Step configuration.
 * @returns True for an invalid kind, slot or allowlist.
 */
function isInvalid(step: IStepConfig): boolean {
  const capture: unknown = step.structuredCapture;
  if (capture === undefined) return false;
  if (typeof capture !== 'object' || capture === null) return true;
  const kind: unknown = Reflect.get(capture, 'kind');
  const into: unknown = Reflect.get(capture, 'into');
  if (typeof kind !== 'string' || !Object.hasOwn(CAPTURE_CHECKS, kind)) return true;
  if (kind !== 'jwt-claims' && (typeof into !== 'string' || into.trim() === '')) return true;
  return !CAPTURE_CHECKS[kind](capture);
}

/**
 * Whether an indirect step writer also targets the capture slot.
 * @param step - Step configuration.
 * @param slot - Capture slot.
 * @returns True for a classifier, generator or codec output.
 */
function hasIndirectConflict(step: IStepConfig, slot: string): boolean {
  const cases = step.classify === undefined ? [] : answerCapturesOf(step.classify);
  if (cases.some(([written]) => written === slot)) return true;
  if ((step.generate ?? []).flatMap(generatedSlots).includes(slot)) return true;
  const codec = step.codec;
  return codec?.mode === 'exchange' && [codec.keyInto, codec.sessionInto].includes(slot);
}

/**
 * Whether the capture overlaps another direct or extracted slot.
 * @param step - Step configuration.
 * @param slot - Capture slot.
 * @returns True for an existing output slot.
 */
function hasDirectConflict(step: IStepConfig, slot: string): boolean {
  const direct = [
    step.finalUrlInto,
    step.formCapture?.into,
    step.locationCapture?.into,
    step.classify?.into,
    step.preHook?.intoCarryField,
  ];
  return direct.includes(slot) || isExtractSlot(step, slot);
}

/**
 * Whether another direct writer targets a capture output slot.
 * @param step - Step configuration.
 * @param slot - Capture output slot.
 * @returns True for an overlapping carry output.
 */
function isConflicting(step: IStepConfig, slot: string): boolean {
  if (hasDirectConflict(step, slot)) return true;
  if (hasIndirectConflict(step, slot)) return true;
  return step.deriveCarry?.some(entry => entry.into === slot) ?? false;
}

/**
 * Whether any structured output overlaps another step writer.
 * @param step - Step configuration.
 * @returns True for an overlapping carry output.
 */
function isStale(step: IStepConfig): boolean {
  const slots = structuredSlotsOf(step);
  return slots.some(slot => isConflicting(step, slot));
}

const API_DIRECT_STRUCTURED_CAPTURE_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.structuredCapture: needs a text response', isBroken: anyStep(isOffText) },
  { message: 'steps.structuredCapture: invalid capture', isBroken: anyStep(isInvalid) },
  { message: 'steps.structuredCapture: must be a fresh slot', isBroken: anyStep(isStale) },
];

export default API_DIRECT_STRUCTURED_CAPTURE_RULES;
export { API_DIRECT_STRUCTURED_CAPTURE_RULES };
