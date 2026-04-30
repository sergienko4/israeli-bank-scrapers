/**
 * Login submit step — thin orchestration, delegates to Mediator.
 * Step-based API: uses mediator-based fillAndSubmit (legacy path for tests/builder).
 * Phase-based API (LoginPhase.ts) uses discovery-based fillFromDiscovery.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { fillAndSubmit } from '../Form/LoginFormActions.js';

/**
 * Run mediator-based fill+submit and merge result into context.
 * @param config - Login config.
 * @param mediator - Element mediator (already guarded).
 * @param input - Pipeline context.
 * @returns Updated context with submitMethod.
 */
async function runFillAndSubmit(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const creds = input.credentials as Record<string, string>;
  const result = await fillAndSubmit({ mediator, config, creds, logger: input.logger });
  if (!result.success) return result;
  const diag = { ...input.diagnostics, submitMethod: result.value.method };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Execute the loginAction step — guard + delegate to mediator-based fill.
 * @param config - Bank's login config.
 * @param input - Context with mediator + login state.
 * @returns Same context with submitMethod in diagnostics.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'gate: loginAreaReady=false');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'no login state');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  return runFillAndSubmit(config, input.mediator.value, input);
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
