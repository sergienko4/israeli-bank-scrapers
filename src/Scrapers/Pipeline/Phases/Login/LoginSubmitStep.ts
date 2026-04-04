/**
 * Login submit step — thin orchestration, delegates to Mediator.
 * All field resolution + submit logic in Mediator/Login/LoginPhaseActions.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { executeFillAndSubmit } from '../../Mediator/Login/LoginPhaseActions.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/**
 * Execute the loginAction step — guard + delegate to Mediator.
 * @param config - Bank's login config.
 * @param input - Context with login.activeFrame.
 * @returns Same context with submitMethod in diagnostics.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'gate: loginAreaReady=false');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  return executeFillAndSubmit(config, input.mediator.value, input);
}

/**
 * Create the loginAction step.
 * @param config - Bank's login config.
 * @returns Pipeline step: fill fields + click submit.
 */
function createLoginActionStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  /**
   * Execute login action delegate.
   * @param _c - Unused context.
   * @param i - Pipeline input.
   * @returns Login result.
   */
  const exec = async (
    _c: IPipelineContext,
    i: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> => await executeLoginAction(config, i);
  return { name: 'login-action', execute: exec };
}

export default executeLoginAction;
export { createLoginActionStep, executeLoginAction };
