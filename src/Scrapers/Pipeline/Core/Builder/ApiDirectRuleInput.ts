/**
 * What the api-direct build-time rules read, the shape of one rule, and the
 * step walk, extract-slot and cookie-domain checks they share. Kept apart so every rule
 * module imports it without importing the validator that runs them.
 */

import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { captureSlotsOf } from '../../Mediator/ApiDirectCall/Flow/RunStep.textCapture.js';
import type { IHeadlessUrlsConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/** What the rules read: the call config and the bank's headless block. */
interface IApiDirectRuleInput {
  readonly call: IApiDirectCallConfig;
  readonly headless: IHeadlessUrlsConfig | false;
}

/** One rule: the failure text and the check that finds it broken. */
interface IApiDirectRule {
  readonly message: string;
  readonly isBroken: (input: IApiDirectRuleInput) => boolean;
}

/**
 * Every login step, including durable resume steps.
 * @param call - Call config.
 * @returns All steps the config can run.
 */
function allSteps(call: IApiDirectCallConfig): readonly IStepConfig[] {
  const resume = call.persistentAuth?.resumeSteps ?? [];
  return [...call.steps, ...resume];
}

/**
 * Whether a slot names one of a step's body, header or text-capture slots.
 * @param step - Step config.
 * @param slot - Carry slot.
 * @returns True for a required, optional, header or text-capture slot.
 */
function isExtractSlot(step: IStepConfig, slot: string): boolean {
  const optional = step.optionalExtractsToCarry ?? {};
  const headers = step.headerExtractsToCarry ?? {};
  const slotMaps = [step.extractsToCarry, optional, headers];
  if (slotMaps.some(slotMap => Object.hasOwn(slotMap, slot))) return true;
  return captureSlotsOf(step).includes(slot);
}

/**
 * Whether the bank's session jar is scoped to cookie domains, as a warm start
 * that restores or exports the jar needs.
 * @param input - Rule input.
 * @returns True when `headless.cookieDomains` is set.
 */
function hasCookieDomains(input: IApiDirectRuleInput): boolean {
  return input.headless !== false && input.headless.cookieDomains !== undefined;
}

export type { IApiDirectRule, IApiDirectRuleInput };
export { allSteps, hasCookieDomains, isExtractSlot };
