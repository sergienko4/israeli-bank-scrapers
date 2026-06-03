/**
 * DASHBOARD ACTION phase orchestration — physical navigation
 * dispatcher.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap. The identity-then-
 * fallback click walker lives in
 * {@link "./DashboardPhaseActions.action.walker.js"}.
 */

import type { IActionContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { NO_HREF } from './DashboardDiscovery.js';
import { runIdentityThenFallback } from './DashboardPhaseActions.action.walker.js';
import { executeHrefNav, executeMenuClick } from './DashboardPhaseActions.menu.js';

/** Bundled candidate-navigation diagnostics fields. */
interface ICandidateNavDiag {
  readonly target?: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
  readonly menuTarget?: IResolvedTarget;
  readonly hrefTarget?: string;
}

/**
 * Read the four diagnostics fields the candidate-navigation loop needs.
 * @param diag - Action diagnostics from PRE.
 * @returns Bundled candidate-navigation inputs.
 */
function readCandidateNavDiag(diag: IActionContext['diagnostics']): ICandidateNavDiag {
  return {
    target: diag.dashboardTarget,
    fallbackSelector: diag.dashboardFallbackSelector ?? NO_HREF,
    count: diag.dashboardCandidateCount ?? 0,
    menuTarget: diag.dashboardMenuTarget,
    hrefTarget: diag.dashboardTargetUrl,
  };
}

/** Bundled executor + sealed action context for {@link runIdentityBranch}. */
interface IIdentityCtx {
  readonly executor: IActionMediator;
  readonly input: IActionContext;
}

/**
 * Run the identity-then-fallback walker for {@link runTargetBranch}.
 * @param diag - Bundled candidate-nav diagnostics (target field unused).
 * @param target - The resolved primary target (caller already narrowed).
 * @param ctx - Bundled executor + sealed action context.
 * @returns Procedure carrying the post-walker action context.
 */
function runIdentityBranch(
  diag: ICandidateNavDiag,
  target: IResolvedTarget,
  ctx: IIdentityCtx,
): Promise<Procedure<IActionContext>> {
  const { fallbackSelector, count } = diag;
  const { executor, input } = ctx;
  return runIdentityThenFallback({ executor, target, fallbackSelector, count, input });
}

/**
 * Dispatch the appropriate ACTION branch when a primary target was
 * resolved by PRE — identity-then-fallback walker, or href-nav fallback.
 * @param diag - Bundled candidate-nav diagnostics.
 * @param executor - Sealed action mediator.
 * @param input - Sealed action context.
 * @returns Procedure carrying the post-nav action context.
 */
async function runTargetBranch(
  diag: ICandidateNavDiag,
  executor: IActionMediator,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (diag.target) return runIdentityBranch(diag, diag.target, { executor, input });
  if (diag.hrefTarget) await executeHrefNav(executor, diag.hrefTarget, input.logger);
  return succeed(input);
}

/**
 * Candidate navigation — owned ENTIRELY by ACTION. Executes any pre-
 * resolved menu fallback, then dispatches to the target branch
 * (identity walker or href nav).
 * @param input - Sealed action context.
 * @param executor - Sealed action mediator (caller already unwrapped).
 * @returns Procedure carrying the post-nav action context.
 */
async function runCandidateNavigation(
  input: IActionContext,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const diag = readCandidateNavDiag(input.diagnostics);
  if (diag.menuTarget) await executeMenuClick(executor, diag.menuTarget, input.logger);
  return runTargetBranch(diag, executor, input);
}

/**
 * Mark the dashboard click moment on the executor and delegate to the
 * candidate-navigation dispatcher.
 * @param input - Sealed action context (executor already present).
 * @param executor - Sealed action mediator (caller already unwrapped).
 * @returns Procedure carrying the post-nav action context.
 */
function markClickAndNavigate(
  input: IActionContext,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const clickAtMs = Date.now();
  executor.markDashboardClickAt(clickAtMs);
  return runCandidateNavigation(input, executor);
}

/**
 * Inner "we have an executor" branch of {@link executeDashboardNavigationSealed}.
 * @param input - Sealed action context (executor already present).
 * @param executor - Sealed action mediator (caller already unwrapped).
 * @returns Procedure carrying the post-nav action context.
 */
function runSealedNavWithExecutor(
  input: IActionContext,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  if (input.diagnostics.dashboardTrafficExists) {
    input.logger.debug({ message: 'traffic exists -- still click for post-nav API' });
  }
  return markClickAndNavigate(input, executor);
}

/**
 * ACTION (sealed): Physical navigation -- best-effort click.
 * @param input - Sealed action context with executor + diagnostics targets.
 * @returns Always succeed -- POST is the validator.
 */
async function executeDashboardNavigationSealed(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) {
    input.logger.debug({ message: 'no executor -- traffic from login' });
    return succeed(input);
  }
  return runSealedNavWithExecutor(input, input.executor.value);
}

export default executeDashboardNavigationSealed;
export { executeDashboardNavigationSealed };
