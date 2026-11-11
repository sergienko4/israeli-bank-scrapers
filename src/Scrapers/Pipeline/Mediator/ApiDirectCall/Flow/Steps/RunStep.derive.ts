/**
 * Step-level derived carry — once a step's extracts are merged into
 * scope, its `deriveCarry` entries run, in order, through the flow-init
 * evaluator (`applyDerivations`) over that scope. There is no second
 * evaluator: parts, separators, truncation and part failures are the
 * flow-init ones; an op failure names the step (`<step> derive <slot>
 * unformattable`).
 */

import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk, succeed } from '../../../../Types/Procedure.js';
import type { IStepConfig } from '../../ConfigContracts/index.js';
import { applyJwtCapture } from '../Captures/RunStep.jwtCapture.js';
import {
  applyDerivations,
  type IApplyDerivedCarryArgs,
} from '../Lifecycle/FlowInitCarry.derived.js';
import type { ITemplateScope } from './RunStep.types.js';

/**
 * The evaluator args for a step: a copy of its carry, and the step as the
 * owner an op failure names.
 * @param step - Step config.
 * @param scope - Scope already holding the step's extracts.
 * @returns Evaluator args.
 */
function stepDeriveArgs(step: IStepConfig, scope: ITemplateScope): IApplyDerivedCarryArgs {
  const carry = { ...scope.carry };
  const owner = `${step.name} derive`;
  return { config: scope.config, creds: scope.creds, carry, owner };
}

/**
 * Derive a step's carry slots over its merged scope.
 * @param step - Step config.
 * @param scope - Scope already holding the step's extracts.
 * @returns Procedure with the scope plus the derived slots, or the failure.
 */
function deriveStepCarry(step: IStepConfig, scope: ITemplateScope): Procedure<ITemplateScope> {
  const bound = applyJwtCapture(step, scope);
  if (!isOk(bound)) return bound;
  const entries = step.deriveCarry ?? [];
  if (entries.length === 0) return bound;
  const args = stepDeriveArgs(step, bound.value);
  const derived = applyDerivations(entries, args);
  if (!isOk(derived)) return derived;
  return succeed({ ...bound.value, carry: derived.value });
}

export default deriveStepCarry;
export { deriveStepCarry };
