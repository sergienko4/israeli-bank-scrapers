/**
 * Answer-classifier slot rules for an api-direct call config, checked
 * after the classifier shape rules. A capture never writes the case slot, and
 * neither the case slot nor a capture slot is a slot the same step also writes:
 * an extract, the final URL, a form capture, a handoff capture or a
 * derivation. The case slot is never kept for the scrape by `sessionCarry`.
 * A `runIf` guard on a slot some classifier writes may list only the case
 * names written to that slot.
 */

import type {
  IAnswerClassifier,
  IStepConfig,
} from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  allSteps,
  answerCapturesOf,
  anyClassifier,
  classifiersOf,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
} from '../ApiDirectRuleInput.js';

/**
 * Every slot a classifier writes: its case slot and its capture slots.
 * @param classifier - Answer classifier.
 * @returns The slots, case slot first.
 */
function slotsOf(classifier: IAnswerClassifier): readonly string[] {
  const captures = answerCapturesOf(classifier).map(([slot]) => slot);
  return [classifier.into, ...captures];
}

/**
 * Whether a capture writes the case slot.
 * @param classifier - Answer classifier.
 * @returns True for a capture into `into`.
 */
function capturesIntoCase(classifier: IAnswerClassifier): boolean {
  const captures = answerCapturesOf(classifier);
  return captures.some(([slot]): boolean => slot === classifier.into);
}

/**
 * Every slot besides an extract that the step itself writes.
 * @param step - The step that declares the classifier.
 * @returns The final-URL, form-capture, handoff-capture and derived slots.
 */
function stepWriteSlotsOf(step: IStepConfig): readonly string[] {
  const derived = step.deriveCarry?.map((entry): string => entry.into) ?? [];
  const slots = [step.finalUrlInto, step.formCapture?.into, step.locationCapture?.into, ...derived];
  return slots.filter((slot): slot is string => slot !== undefined);
}

/**
 * Whether a classified slot is also a slot the step writes: an extract slot,
 * its final URL, its form/handoff capture or a derivation.
 * @param classifier - Answer classifier.
 * @param step - The step that declares it.
 * @returns True for a clash.
 */
function hasStepSlotClash(classifier: IAnswerClassifier, step: IStepConfig): boolean {
  const written = stepWriteSlotsOf(step);
  const slots = slotsOf(classifier);
  return slots.some((slot): boolean => isExtractSlot(step, slot) || written.includes(slot));
}

/**
 * Whether `sessionCarry` keeps a case slot.
 * @param input - Rule input.
 * @returns True when a classifier's `into` is kept.
 */
function keepsCaseSlot(input: IApiDirectRuleInput): boolean {
  const kept = input.call.sessionCarry ?? [];
  const classifiers = classifiersOf(input.call);
  return classifiers.some((classifier): boolean => kept.includes(classifier.into));
}

/**
 * Every case name written to a slot, across the classifiers.
 * @param classifiers - Answer classifiers.
 * @param slot - Carry slot.
 * @returns The names; empty when no classifier writes the slot.
 */
function caseNamesOf(classifiers: readonly IAnswerClassifier[], slot: string): readonly string[] {
  const writers = classifiers.filter(classifier => classifier.into === slot);
  return writers.flatMap(({ cases }) => cases.map(answerCase => answerCase.name));
}

/**
 * Whether a step's guard on a classifier slot lists a name no case has.
 * @param step - Step config.
 * @param classifiers - Answer classifiers.
 * @returns True for a stray guard text.
 */
function hasStrayGuardText(step: IStepConfig, classifiers: readonly IAnswerClassifier[]): boolean {
  if (step.runIf === undefined) return false;
  const names = caseNamesOf(classifiers, step.runIf.carry);
  if (names.length === 0) return false;
  return step.runIf.oneOf.some((text): boolean => !names.includes(text));
}

/**
 * Whether any login or resume step guards a classifier slot on a stray name.
 * @param input - Rule input.
 * @returns True for a stray guard text.
 */
function hasStrayGuard(input: IApiDirectRuleInput): boolean {
  const classifiers = classifiersOf(input.call);
  const steps = allSteps(input.call);
  return steps.some((step): boolean => hasStrayGuardText(step, classifiers));
}

/** Answer-classifier slot rules, checked after the classifier shape rules. */
const API_DIRECT_CLASSIFY_SLOT_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.classify.captures: a slot must not be into',
    isBroken: anyClassifier(capturesIntoCase),
  },
  {
    message: 'steps.classify: slots must not be slots the step also writes',
    isBroken: anyClassifier(hasStepSlotClash),
  },
  { message: 'steps.classify.into: must not be a sessionCarry slot', isBroken: keepsCaseSlot },
  {
    message: 'steps.runIf: on a classifier slot, oneOf lists only case names',
    isBroken: hasStrayGuard,
  },
];

export default API_DIRECT_CLASSIFY_SLOT_RULES;
export { API_DIRECT_CLASSIFY_SLOT_RULES };
