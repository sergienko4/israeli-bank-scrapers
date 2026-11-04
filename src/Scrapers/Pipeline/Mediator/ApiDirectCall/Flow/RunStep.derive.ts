/**
 * Step-level derived carry (N7) — once a step's extracts are merged into
 * scope, its `deriveCarry` entries run, in order, through the flow-init
 * evaluator (`applyDerivations`) over that scope. There is no second
 * evaluator: parts, separators, truncation and failure messages are the
 * flow-init ones.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IStepConfig } from '../ConfigContracts/index.js';
import { applyDerivations } from './FlowInitCarry.derived.js';
import type { ITemplateScope } from './RunStep.types.js';

/**
 * Derive a step's carry slots over its merged scope.
 * @param step - Step config.
 * @param scope - Scope already holding the step's extracts.
 * @returns Procedure with the scope plus the derived slots, or the failed part.
 */
function deriveStepCarry(step: IStepConfig, scope: ITemplateScope): Procedure<ITemplateScope> {
  const entries = step.deriveCarry ?? [];
  if (entries.length === 0) return succeed(scope);
  const carry = { ...scope.carry };
  const derived = applyDerivations(entries, { config: scope.config, creds: scope.creds, carry });
  if (!isOk(derived)) return derived;
  return succeed({ ...scope, carry: derived.value });
}

export default deriveStepCarry;
export { deriveStepCarry };
