/**
 * LOGIN.POST validator + bounce detector + auth-API failure check.
 *
 * <p>Thin façade composing PostValidate/* sub-modules.
 *
 * <p>Phase 12d split: see PostValidate/{PostValidateDetect,
 * PostValidateGates,PostValidateFlow}.ts for the implementations.
 */

import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import {
  type IValidateLoginArgs,
  runPostFormAndLateChecks,
} from './PostValidate/PostValidateFlow.js';
import { checkLoginPostGates, runPostLoadingGate } from './PostValidate/PostValidateGates.js';

/**
 * Run the loading-gate + form/late-checks pipeline.
 * @param args - Bundled validate-login args.
 * @returns Resolved Procedure.
 */
async function runValidateLoginAfterGates(
  args: IValidateLoginArgs,
): Promise<Procedure<IPipelineContext>> {
  const earlyGate = await runPostLoadingGate(args.mediator, args.activeFrame);
  if (earlyGate !== false) return earlyGate;
  return runPostFormAndLateChecks(args, args.page);
}

/**
 * POST: Validate login.
 * @param config - Login config.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Succeed or fail with error type.
 */
async function executeValidateLogin(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const ready = checkLoginPostGates(input);
  if (ready.tag === 'fail') return ready.proc;
  const { page, activeFrame } = ready;
  return runValidateLoginAfterGates({ config, mediator, input, page, activeFrame });
}

export default executeValidateLogin;
export { executeValidateLogin };

export { detectAsyncLoginErrors } from './PostValidate/PostValidateDetect.js';
