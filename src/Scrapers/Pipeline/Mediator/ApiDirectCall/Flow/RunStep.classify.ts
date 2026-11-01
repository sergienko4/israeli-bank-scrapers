/**
 * Answer classifier (N50). A step's `classify` runs on its opened answer after
 * `failIfPresent` and `outcome` and before its extracts. Exactly one case must
 * match — case names may repeat, cases are counted — so none fails
 * `<step> answer unrecognized` and more than one `<step> answer ambiguous`,
 * both Generic, and either logs the answer's redacted shape
 * (`RunStep.classify.shape.ts`). A matched `fail` case stops the step
 * `<step> answer <case>` with its type; any other writes its name to carry
 * `into`, beside its captures (`RunStep.classify.captures.ts`).
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IAnswerCase, IAnswerClassifier, IStepConfig } from '../ConfigContracts/index.js';
import { readCaptures } from './RunStep.classify.captures.js';
import { passesCheck } from './RunStep.classify.checks.js';
import { answerShape } from './RunStep.classify.shape.js';
import type { CarryMap, JsonValue } from './RunStep.types.js';

const LOG = getDebug(import.meta.url);

/** One classification: the step, its classifier and its opened answer. */
interface IClassifyInput {
  readonly stepName: string;
  readonly classifier: IAnswerClassifier;
  readonly resp: JsonValue;
}

/**
 * Whether every check of a case passes.
 * @param resp - Opened answer.
 * @param answerCase - The case.
 * @returns True when the case matches.
 */
function isCaseMatch(resp: JsonValue, answerCase: IAnswerCase): boolean {
  return answerCase.when.every(check => passesCheck(resp, check));
}

/**
 * Refuse an answer that no case or more than one case matched, logging its
 * redacted shape and the matched case names.
 * @param input - The classification.
 * @param matched - The matched cases.
 * @returns The Generic refusal.
 */
function refuseAnswer(input: IClassifyInput, matched: readonly IAnswerCase[]): Procedure<CarryMap> {
  const verdict = matched.length === 0 ? 'unrecognized' : 'ambiguous';
  const shape = answerShape(input.resp);
  const matchedCases = matched.map(answerCase => answerCase.name);
  const message = `[classify] answer ${verdict}`;
  LOG.debug({ stepName: input.stepName, matchedCases, shape, message });
  return fail(ScraperErrorTypes.Generic, `${input.stepName} answer ${verdict}`);
}

/**
 * Apply the one matched case: stop on a `fail` case, else write its name and
 * captures.
 * @param input - The classification.
 * @param matched - The matched case.
 * @returns The classifier's carry, or the failure.
 */
function applyCase(input: IClassifyInput, matched: IAnswerCase): Procedure<CarryMap> {
  if (matched.fail !== undefined) {
    return fail(matched.fail, `${input.stepName} answer ${matched.name}`);
  }
  const captured = readCaptures(input, matched);
  if (!isOk(captured)) return captured;
  return succeed({ ...captured.value, [input.classifier.into]: matched.name });
}

/**
 * Classify a step's opened answer, if the step declares a classifier.
 * @param step - The step that just answered.
 * @param resp - Opened, guarded answer.
 * @returns The classifier's carry ({} with no classifier), or the failure.
 */
function classifyAnswer(step: IStepConfig, resp: JsonValue): Procedure<CarryMap> {
  const classifier = step.classify;
  if (classifier === undefined) return succeed({});
  const input: IClassifyInput = { stepName: step.name, classifier, resp };
  const matched = classifier.cases.filter(answerCase => isCaseMatch(resp, answerCase));
  if (matched.length !== 1) return refuseAnswer(input, matched);
  return applyCase(input, matched[0]);
}

export default classifyAnswer;

export { classifyAnswer };
