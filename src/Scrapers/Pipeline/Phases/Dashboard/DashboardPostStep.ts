/**
 * Dashboard POST step — change-password check, soft traffic gate, state build.
 * All WK/network logic delegated to Mediator.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { validateTrafficGate } from '../../Mediator/Dashboard/DashboardDiscovery.js';
import checkChangePassword from '../../Mediator/Dashboard/DashboardProbe.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IDashboardState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Strategy lookup: PROXY stays PROXY, all others → DIRECT. */
const DASH_STRATEGY_MAP: Record<string, 'DIRECT' | 'PROXY'> = {
  PROXY: 'PROXY',
  BYPASS: 'DIRECT',
  TRIGGER: 'DIRECT',
};

/**
 * Build dashboard state after traffic gate check.
 * @param mediator - Narrowed element mediator.
 * @param input - Pipeline context.
 * @param isPrimed - Whether traffic was primed.
 * @returns Updated context with dashboard state.
 */
function buildDashboardState(
  mediator: IElementMediator,
  input: IPipelineContext,
  isPrimed: boolean,
): Procedure<IPipelineContext> {
  const pageUrl = mediator.getCurrentUrl();
  const dashStrategy = input.diagnostics.dashboardStrategy ?? 'BYPASS';
  const strategy = DASH_STRATEGY_MAP[dashStrategy] ?? 'DIRECT';
  const masked = maskVisibleText(pageUrl);
  input.logger.debug({ event: 'dashboard-post', strategy, primed: isPrimed, url: masked });
  const dashState: IDashboardState = { isReady: true, pageUrl, trafficPrimed: isPrimed };
  return succeed({ ...input, dashboard: some(dashState) });
}

/**
 * Execute POST: change-password check + soft traffic gate + state build.
 * @param input - Pipeline context with mediator.
 * @returns Updated context — never fails on traffic.
 */
async function executeDashboardPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD POST');
  const mediator = input.mediator.value;
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  const dashStrategy = input.diagnostics.dashboardStrategy ?? 'BYPASS';
  const isPrimed = validateTrafficGate({
    network: mediator.network,
    dashStrategy,
    hasProxy: false,
    logger: input.logger,
  });
  return buildDashboardState(mediator, input, isPrimed);
}

export default executeDashboardPost;
export { executeDashboardPost };
