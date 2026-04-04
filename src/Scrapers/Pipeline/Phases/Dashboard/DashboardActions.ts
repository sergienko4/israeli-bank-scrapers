/**
 * Dashboard action — orchestrates strategy dispatch to Mediator.
 * Phase owns the flow, Mediator owns the logic.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { buildApiContext } from '../../Mediator/Dashboard/DashboardDiscovery.js';
import {
  triggerDashboardUi,
  triggerProxyDashboard,
} from '../../Mediator/Dashboard/DashboardTrigger.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

export { executeDashboardPost } from './DashboardPostStep.js';

/**
 * Dispatch TRIGGER strategy — click UI to generate traffic.
 * @param input - Pipeline context with mediator.
 * @returns Procedure succeed when done.
 */
async function dispatchTrigger(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.mediator.has) return succeed(false);
  return triggerDashboardUi(input.mediator.value);
}

/**
 * Activate server-side session for PROXY banks (ValidateIdData + performLogon).
 * @param input - Pipeline context with credentials + config + fetchStrategy.
 * @returns Procedure succeed(true) if activated, or succeed(false) if not needed.
 */
async function activateProxySession(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.fetchStrategy.has) return succeed(false);
  const strategy = input.fetchStrategy.value;
  if (!strategy.activateSession) return succeed(true);
  process.stderr.write('[DASHBOARD.ACTION] PROXY: activating session...\n');
  const proxyUrl = input.diagnostics.discoveredProxyUrl;
  const result = await strategy.activateSession(input.credentials, input.config, proxyUrl);
  /** Activation result labels. */
  const tagMap: Record<string, string> = { true: 'OK', false: 'FAIL' };
  const tag = tagMap[String(result.success)];
  process.stderr.write(`[DASHBOARD.ACTION] PROXY: session activation=${tag}\n`);
  return result;
}

/**
 * Dispatch PROXY strategy — activate session, then fire dashboard API.
 * @param input - Pipeline context with mediator + fetchStrategy + proxyUrl.
 * @returns Procedure succeed when done.
 */
async function dispatchProxy(input: IPipelineContext): Promise<Procedure<boolean>> {
  if (!input.mediator.has) return succeed(false);
  if (!input.fetchStrategy.has) return succeed(false);
  if (!input.diagnostics.discoveredProxyUrl) return succeed(false);
  const sessionResult = await activateProxySession(input);
  if (!sessionResult.success) return sessionResult;
  return triggerProxyDashboard({
    mediator: input.mediator.value,
    strategy: input.fetchStrategy.value,
    proxyUrl: input.diagnostics.discoveredProxyUrl,
    proxyParams: input.config.auth?.params,
  });
}

/**
 * BYPASS no-op — traffic already captured, nothing to do.
 * @returns Resolved succeed(true).
 */
function dispatchBypass(): Promise<Procedure<boolean>> {
  const result = succeed(true);
  return Promise.resolve(result);
}

/** Strategy dispatch: maps strategy name → handler. */
const STRATEGY_DISPATCH: Record<string, (i: IPipelineContext) => Promise<Procedure<boolean>>> = {
  TRIGGER: dispatchTrigger,
  PROXY: dispatchProxy,
  BYPASS: dispatchBypass,
};

/**
 * Execute ACTION: cache auth → dispatch strategy → build API context.
 * @param input - Pipeline context.
 * @returns Updated context with api populated.
 */
async function executeDashboardAction(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
  if (!input.fetchStrategy.has) return succeed(input);
  const network = input.mediator.value.network;
  await network.cacheAuthToken();
  const strategy = input.diagnostics.dashboardStrategy ?? 'BYPASS';
  const handler = STRATEGY_DISPATCH[strategy];
  await handler(input);
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value);
  return succeed({ ...input, api: some(apiCtx) });
}

export { executeDashboardAction };
