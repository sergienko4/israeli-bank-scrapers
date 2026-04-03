/**
 * Login submit step — orchestrates fill + submit via mediator.
 * All field resolution + submit logic in Mediator/Form/LoginFormActions.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { fillAndSubmit } from '../../Mediator/Form/LoginFormActions.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/**
 * Execute the loginAction step body.
 * Stores submit method in diagnostics so POST knows what to validate.
 * @param config - Bank's login config.
 * @param input - Context with login.activeFrame.
 * @returns Same context with submitMethod in diagnostics.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'gate: loginAreaReady=false');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login context');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  const creds = input.credentials as Record<string, string>;
  const result = await fillAndSubmit(input.mediator.value, config, creds);
  if (!result.success) return result;
  const diag = { ...input.diagnostics, submitMethod: result.value.method };
  return succeed({ ...input, diagnostics: diag });
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
