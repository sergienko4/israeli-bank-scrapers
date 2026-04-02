/**
 * Dashboard POST step — change-password check, soft traffic gate, state build.
 * All WK/network logic delegated to Mediator.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { validateTrafficGate } from '../../Mediator/Dashboard/DashboardDiscovery.js';
import checkChangePassword from '../../Mediator/Dashboard/DashboardProbe.js';
import { some } from '../../Types/Option.js';
import type { IDashboardState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

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
  const hasProxy = false;
  const isPrimed = validateTrafficGate(mediator.network, dashStrategy, hasProxy);
  const pageUrl = mediator.getCurrentUrl();
  const tag = `strategy=${dashStrategy} primed=${String(isPrimed)}`;
  process.stderr.write(`    [DASHBOARD.POST] ${tag} url=${pageUrl}\n`);
  const dashState: IDashboardState = { isReady: true, pageUrl, trafficPrimed: isPrimed };
  return succeed({ ...input, dashboard: some(dashState) });
}

export default executeDashboardPost;
export { executeDashboardPost };
