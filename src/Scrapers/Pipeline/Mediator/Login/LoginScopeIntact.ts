/**
 * LOGIN.POST scope-intact validator + OTP disambiguator (facade).
 *
 * <p>Phase 12d split: implementation moved to {@link ./ScopeIntact/}.
 * This file is a thin facade that composes the sub-modules and
 * preserves the public surface (default + named export).
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { disambiguateScopeIntact } from './ScopeIntact/ScopeIntactDisambiguate.js';
import { makeScopeArgs, probeScopeIntact } from './ScopeIntact/ScopeIntactProbe.js';

/**
 * M2 (CI quality hardening) — scope-bound LOGIN.POST validation.
 * Combines URL stability + password target presence + OTP screen probe.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure when scope is broken, otherwise `false`.
 */
async function validateActionScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  const probe = await probeScopeIntact(mediator, input);
  if (probe === false) return false;
  const scopeArgs = makeScopeArgs(input, probe);
  return disambiguateScopeIntact(mediator, scopeArgs);
}

export default validateActionScopeIntact;
export { validateActionScopeIntact };
