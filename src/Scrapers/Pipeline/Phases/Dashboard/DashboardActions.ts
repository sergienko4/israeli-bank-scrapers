/**
 * Dashboard action helpers — session activation, trigger nav, API context.
 * POST logic in DashboardPostStep.ts.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  buildApiContext,
  NO_HREF,
  triggerOrganicDashboard,
} from '../../Strategy/DashboardDiscoveryStep.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

export { executeDashboardPost } from './DashboardPostStep.js';

const LOG = createLogger('dashboard-phase');

/**
 * Run strategy.activateSession if available.
 * @param ctx - Pipeline context.
 * @returns Activation result procedure.
 */
async function runActivation(ctx: IPipelineContext): Promise<Procedure<boolean>> {
  if (!ctx.fetchStrategy.has) return succeed(true);
  const strategy = ctx.fetchStrategy.value;
  if (!strategy.activateSession) return succeed(true);
  LOG.debug('[ACTION] activating session via Strategy hook');
  return strategy.activateSession(ctx.credentials, ctx.config);
}

/**
 * Try session activation via Strategy hook.
 * @param ctx - Pipeline context.
 * @returns Succeed or fail.
 */
async function trySessionActivation(ctx: IPipelineContext): Promise<Procedure<void>> {
  const activation = await runActivation(ctx);
  if (!activation.success) {
    const msg = `Session activation failed: ${activation.errorMessage}`;
    return fail(ScraperErrorTypes.Generic, msg);
  }
  LOG.debug('[ACTION] activation: success=%s', activation.success);
  return succeed(undefined);
}

/**
 * Execute TRIGGER: activate session + navigate dashboard.
 * @param ctx - Pipeline context.
 * @returns Succeed or fail.
 */
async function executeTriggerNav(ctx: IPipelineContext): Promise<Procedure<void>> {
  const result = await trySessionActivation(ctx);
  if (!result.success) return result;
  const apiBase = ctx.config.api.base;
  if (!apiBase || !ctx.mediator.has) return succeed(undefined);
  return triggerOrganicDashboard(ctx.mediator.value, apiBase);
}

/** Whether trigger navigation should execute. */
type ShouldTrigger = boolean;

/**
 * Decide whether trigger navigation is needed.
 * @param input - Pipeline context.
 * @returns True if TRIGGER strategy with a target URL.
 */
function shouldRunTrigger(input: IPipelineContext): ShouldTrigger {
  const isTrigger = input.diagnostics.dashboardStrategy === 'TRIGGER';
  const targetUrl = input.diagnostics.dashboardTargetUrl ?? NO_HREF;
  return isTrigger && Boolean(targetUrl);
}

/**
 * Optionally run trigger navigation if needed.
 * @param input - Pipeline context.
 * @returns Succeed or trigger failure.
 */
async function maybeRunTrigger(input: IPipelineContext): Promise<Procedure<void>> {
  if (!shouldRunTrigger(input)) return succeed(undefined);
  return await executeTriggerNav(input);
}

/**
 * Execute ACTION: trigger navigation + build API context.
 * @param input - Pipeline context with mediator and fetchStrategy.
 * @returns Updated context with api populated.
 */
async function executeDashboardAction(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
  if (!input.fetchStrategy.has) return succeed(input);
  const triggerResult = await maybeRunTrigger(input);
  if (!triggerResult.success) return triggerResult;
  const network = input.mediator.value.network;
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value);
  return succeed({ ...input, api: some(apiCtx) });
}

export { executeDashboardAction };
