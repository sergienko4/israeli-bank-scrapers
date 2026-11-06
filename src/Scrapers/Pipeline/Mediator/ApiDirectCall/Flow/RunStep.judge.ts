/**
 * Judge a step's opened answer before its extracts: its `outcome` code first,
 * then its answer classifier. Either refusal stops the step.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type { IStepConfig } from '../ConfigContracts/index.js';
import { classifyAnswer } from './RunStep.classify.js';
import { judgeStepOutcome } from './RunStep.outcome.js';
import type { CarryMap, JsonValue } from './RunStep.types.js';

/**
 * Judge the outcome, then classify the answer.
 * @param step - The step.
 * @param resp - Opened, guarded answer.
 * @returns The classified carry (empty with no classifier), or the refusal.
 */
function judgeAnswer(step: IStepConfig, resp: JsonValue): Procedure<CarryMap> {
  const judged = judgeStepOutcome(step, resp);
  if (!isOk(judged)) return judged;
  return classifyAnswer(step, resp);
}

export default judgeAnswer;

export { judgeAnswer };
