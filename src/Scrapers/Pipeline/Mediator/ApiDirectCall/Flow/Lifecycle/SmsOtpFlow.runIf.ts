/**
 * Conditional steps. A step whose `runIf` guard names a carry slot runs
 * only when that slot holds text equal to one of `oneOf`, compared without
 * case. The reducer checks the guard before the pre-hook, so a skipped step
 * neither asks for a code nor sends a request. A slot that is missing or not
 * text skips the step. The debug log names the step, never the slot's value.
 */

import { getDebug } from '../../../../Logging/Debug.js';
import type { IApiDirectCallConfig, IRunIf } from '../../ConfigContracts/index.js';
import type { ITemplateScope } from '../../Template/RefResolver.js';

const LOG = getDebug(import.meta.url);

/** One step of a call config. */
type FlowStep = IApiDirectCallConfig['steps'][number];

/**
 * Whether the carry meets a guard.
 * @param guard - The step's guard.
 * @param carry - The current carry.
 * @returns True when the slot holds text equal to one of `oneOf`, compared without case.
 */
function isGuardMet(guard: IRunIf, carry: ITemplateScope['carry']): boolean {
  const value = carry[guard.carry];
  if (typeof value !== 'string') return false;
  const text = value.toLowerCase();
  return guard.oneOf.some(allowed => allowed.toLowerCase() === text);
}

/**
 * Whether a step's guard skips it.
 * @param step - Step config.
 * @param scope - Current scope.
 * @returns True when the step has a guard its carry slot does not meet.
 */
function isStepSkipped(step: FlowStep, scope: ITemplateScope): boolean {
  const guard = step.runIf;
  if (guard === undefined) return false;
  if (isGuardMet(guard, scope.carry)) return false;
  LOG.debug({ stepName: step.name, message: '[runIf] step skipped' });
  return true;
}

export default isStepSkipped;
export { isStepSkipped };
