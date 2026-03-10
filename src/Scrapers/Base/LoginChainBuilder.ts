import type { ILoginContext, INamedLoginStep, IStepResult } from '../../Common/LoginMiddleware.js';
import type { ILoginOptions } from './BaseScraperHelpers.js';
import type { ILoginStepContext } from './LoginSteps.js';
import {
  stepCheckEarlyResult,
  stepFillAndSubmit,
  stepNavigate,
  stepOtpCode,
  stepOtpConfirm,
  stepParseLoginPage,
  stepPostAction,
  stepWaitAfterSubmit,
} from './LoginSteps.js';

/** Bundled context for building login chain steps. */
interface ILoginChainBuildOpts {
  stepCtx: ILoginStepContext;
  loginOptions: ILoginOptions;
}

/**
 * Build the first five mandatory steps of the login chain.
 * @param opts - Combined step context and login options.
 * @returns The five core steps: navigate, parse, fill, wait, check.
 */
function buildCoreSteps(opts: ILoginChainBuildOpts): INamedLoginStep[] {
  const { stepCtx, loginOptions } = opts;
  /**
   * Navigate to the login page.
   * @returns Step result indicating whether to continue.
   */
  const doNavigate = (): Promise<IStepResult> => stepNavigate(stepCtx, loginOptions);
  /**
   * Parse login page fields and detect the active frame.
   * @param ctx - The login context with page and setup.
   * @returns Step result indicating whether to continue.
   */
  const doParse = (ctx: ILoginContext): Promise<IStepResult> => stepParseLoginPage(stepCtx, ctx);
  /**
   * Fill credential fields and submit the login form.
   * @param ctx - The login context with page and setup.
   * @returns Step result indicating whether to continue.
   */
  const doFill = (ctx: ILoginContext): Promise<IStepResult> =>
    stepFillAndSubmit(stepCtx, loginOptions, ctx);
  /**
   * Wait for navigation or DOM changes after form submission.
   * @returns Step result indicating whether to continue.
   */
  const doWait = (): Promise<IStepResult> => stepWaitAfterSubmit(stepCtx);
  /**
   * Check for an early login result before optional steps.
   * @returns Step result indicating whether to continue.
   */
  const doCheck = (): Promise<IStepResult> => stepCheckEarlyResult(stepCtx, loginOptions);
  return [
    { name: 'navigate', execute: doNavigate },
    { name: 'parse-page', execute: doParse },
    { name: 'fill', execute: doFill },
    { name: 'wait', execute: doWait },
    { name: 'check-result', execute: doCheck },
  ];
}

/**
 * Append OTP confirm step if the login setup requires it.
 * @param steps - The mutable array to append to.
 * @param stepCtx - The shared step context.
 * @param ctx - The login context with loginSetup flags.
 * @returns True if the step was appended.
 */
function appendOtpConfirm(
  steps: INamedLoginStep[],
  stepCtx: ILoginStepContext,
  ctx: ILoginContext,
): boolean {
  if (!ctx.loginSetup.hasOtpConfirm) return false;
  /**
   * Confirm the OTP delivery method.
   * @returns Step result indicating whether to continue.
   */
  const doOtpConfirm = (): Promise<IStepResult> => stepOtpConfirm(stepCtx);
  steps.push({ name: 'otp-confirm', execute: doOtpConfirm });
  return true;
}

/**
 * Append OTP code step (if needed) and post-action to the chain.
 * @param steps - The mutable array to append to.
 * @param opts - Combined step context and login options.
 * @param ctx - The login context with loginSetup flags.
 * @returns The extended steps array with post-action appended.
 */
function appendRemainingSteps(
  steps: INamedLoginStep[],
  opts: ILoginChainBuildOpts,
  ctx: ILoginContext,
): INamedLoginStep[] {
  const { stepCtx, loginOptions } = opts;
  if (ctx.loginSetup.hasOtpCode) {
    /**
     * Enter the OTP code received by the user.
     * @returns Step result indicating whether to continue.
     */
    const doOtpCode = (): Promise<IStepResult> => stepOtpCode(stepCtx);
    steps.push({ name: 'otp-code', execute: doOtpCode });
  }
  /**
   * Run the post-login action defined in login config.
   * @returns Step result indicating whether to continue.
   */
  const doPost = (): Promise<IStepResult> => stepPostAction(stepCtx, loginOptions);
  steps.push({ name: 'post-action', execute: doPost });
  return steps;
}

/**
 * Construct the ordered login step chain from login options and context.
 * @param stepCtx - The shared step context built from the scraper instance.
 * @param loginOptions - The login configuration from getLoginOptions.
 * @param ctx - The login context with page and loginSetup flags.
 * @returns An ordered array of named login steps.
 */
export default function buildLoginChain(
  stepCtx: ILoginStepContext,
  loginOptions: ILoginOptions,
  ctx: ILoginContext,
): INamedLoginStep[] {
  const opts: ILoginChainBuildOpts = { stepCtx, loginOptions };
  const steps = buildCoreSteps(opts);
  appendOtpConfirm(steps, stepCtx, ctx);
  return appendRemainingSteps(steps, opts, ctx);
}
