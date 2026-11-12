/**
 * What the api-direct build-time rules read, the shape of one rule, and the
 * step walk, any-step, extract-slot, body-pointer, length-cap,
 * answer-classifier walk and cookie-domain checks they share. Kept apart so every rule module imports it
 * without importing the validator that runs them.
 */

import type {
  IAnswerCapture,
  IAnswerCheck,
  IAnswerClassifier,
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { captureSlotsOf } from '../../Mediator/ApiDirectCall/Flow/Captures/RunStep.textCapture.js';
import type { ITransportConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/** Longest value a config `maxChars` may allow. */
const MAX_RULE_CHARS = 65536;

/** A check on one answer classifier and the step that declares it. */
type ClassifierCheck = (classifier: IAnswerClassifier, step: IStepConfig) => boolean;

/** One answer capture: its carry slot and its config. */
type AnswerCaptureEntry = readonly [string, IAnswerCapture];

/** What the rules read: the call config and the bank's transport block. */
interface IApiDirectRuleInput {
  readonly call: IApiDirectCallConfig;
  readonly transport: ITransportConfig | false;
}

/** One rule: the failure text and the check that finds it broken. */
interface IApiDirectRule {
  readonly message: string;
  readonly isBroken: (input: IApiDirectRuleInput) => boolean;
}

/**
 * The durable resume steps; only a bound-device block has any.
 * @param call - Call config.
 * @returns Resume steps, or none.
 */
function resumeStepsOf(call: IApiDirectCallConfig): readonly IStepConfig[] {
  const block = call.persistentAuth;
  if (block?.kind !== 'bound-device') return [];
  return block.resumeSteps;
}

/**
 * Every login step, including durable resume steps.
 * @param call - Call config.
 * @returns All steps the config can run.
 */
function allSteps(call: IApiDirectCallConfig): readonly IStepConfig[] {
  const resume = resumeStepsOf(call);
  return [...call.steps, ...resume];
}

/**
 * A rule check over every login and resume step.
 * @param isBad - Step check.
 * @returns True when any step fails it.
 */
function anyStep(isBad: (step: IStepConfig) => boolean): IApiDirectRule['isBroken'] {
  return (input: IApiDirectRuleInput): boolean => allSteps(input.call).some(isBad);
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
 * Whether a JSON pointer names a node below the body root.
 * @param pointer - JSON pointer.
 * @returns True for `/` followed by at least one character.
 */
function isBodyPointer(pointer: string): boolean {
  return pointer.startsWith('/') && pointer.length > 1;
}

/**
 * Whether a `maxChars` cap is broken.
 * @param maxChars - Configured cap.
 * @returns True unless it is an integer from 1 to 65536.
 */
function isBadCharCap(maxChars: number): boolean {
  return !Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_RULE_CHARS;
}

/**
 * Every answer classifier of the login and resume steps.
 * @param call - Call config.
 * @returns The classifiers, in step order.
 */
function classifiersOf(call: IApiDirectCallConfig): readonly IAnswerClassifier[] {
  const steps = allSteps(call);
  return steps.flatMap((step): readonly IAnswerClassifier[] =>
    step.classify === undefined ? [] : [step.classify],
  );
}

/**
 * A rule check over every step's answer classifier.
 * @param isBad - Classifier check.
 * @returns True when any classifier fails it.
 */
function anyClassifier(isBad: ClassifierCheck): IApiDirectRule['isBroken'] {
  return anyStep((step): boolean => step.classify !== undefined && isBad(step.classify, step));
}

/**
 * Every check of a classifier's cases.
 * @param classifier - Answer classifier.
 * @returns The checks, in case order.
 */
function answerChecksOf(classifier: IAnswerClassifier): readonly IAnswerCheck[] {
  return classifier.cases.flatMap((answerCase): readonly IAnswerCheck[] => answerCase.when);
}

/**
 * Every capture of a classifier's cases, with its slot.
 * @param classifier - Answer classifier.
 * @returns The slot and capture pairs, in case order.
 */
function answerCapturesOf(classifier: IAnswerClassifier): readonly AnswerCaptureEntry[] {
  const maps = classifier.cases.map(answerCase => answerCase.captures ?? {});
  return maps.flatMap((captures): AnswerCaptureEntry[] => Object.entries(captures));
}

/**
 * Whether the bank's session jar is scoped to cookie domains, as a warm start
 * that restores or exports the jar needs.
 * @param input - Rule input.
 * @returns True when `transport.cookieDomains` is set.
 */
function hasCookieDomains(input: IApiDirectRuleInput): boolean {
  return input.transport !== false && input.transport.cookieDomains !== undefined;
}

export type { AnswerCaptureEntry, ClassifierCheck, IApiDirectRule, IApiDirectRuleInput };
export {
  allSteps,
  answerCapturesOf,
  answerChecksOf,
  anyClassifier,
  anyStep,
  classifiersOf,
  hasCookieDomains,
  isBadCharCap,
  isBodyPointer,
  isExtractSlot,
  resumeStepsOf,
};
