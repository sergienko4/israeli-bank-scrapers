/**
 * LOGIN.POST orchestration glue — late-checks, form-scan chain, executor.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginPostValidate.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { detectLoginBounce } from '../LoginPostBounce.js';
import { validateActionScopeIntact } from '../LoginScopeIntact.js';
import { detectAsyncLoginErrors, detectAuthApiFailure } from './PostValidateDetect.js';
import { runPostFormScanAndCallback } from './PostValidateGates.js';

/** Bundle for {@link runValidateLoginAfterGates}. */
export interface IValidateLoginArgs {
  readonly config: ILoginConfig;
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly activeFrame: Page | Frame;
}

/**
 * Runs the post-redirect failure detectors (form-presence + bounce).
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure on detected failure, otherwise `succeed(input)`.
 */
export async function runLatePostChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const scopeIntact = await validateActionScopeIntact(mediator, input);
  if (scopeIntact !== false) return scopeIntact;
  const bounce = detectLoginBounce(mediator, input);
  if (bounce !== false) return bounce;
  return succeed(input);
}

/**
 * Run the late-fire auth-failure + async DOM detectors.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Resolved Procedure for the late checks.
 */
export async function runPostLateChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const lateAuthFail = detectAuthApiFailure(mediator);
  if (lateAuthFail !== false) return lateAuthFail;
  const asyncCheck = await detectAsyncLoginErrors(mediator, input);
  if (asyncCheck !== false) return asyncCheck;
  return runLatePostChecks(mediator, input);
}

/**
 * Run the form-scan + late-checks half of LOGIN.POST.
 * @param args - Bundled validate-login args.
 * @param page - Browser page.
 * @returns Resolved Procedure.
 */
export async function runPostFormAndLateChecks(
  args: IValidateLoginArgs,
  page: Page,
): Promise<Procedure<IPipelineContext>> {
  const formScan = await runPostFormScanAndCallback({ ...args, page });
  if (formScan !== false) return formScan;
  return runPostLateChecks(args.mediator, args.input);
}
