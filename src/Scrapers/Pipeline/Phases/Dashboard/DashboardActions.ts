/** Dashboard action — delegates to Mediator trigger + Strategy activation. */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { buildApiContext } from '../../Mediator/Dashboard/DashboardDiscovery.js';
import { triggerDashboardUi } from '../../Mediator/Dashboard/DashboardTrigger.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

export { executeDashboardPost } from './DashboardPostStep.js';

/**
 * Execute ACTION: Mediator UI trigger + API context build.
 * @param input - Pipeline context.
 * @returns Updated context with api populated.
 */
async function executeDashboardAction(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD');
  if (!input.fetchStrategy.has) return succeed(input);
  const mediator = input.mediator.value;
  const network = mediator.network;
  // Extract + cache auth BEFORE trigger — iframes detach after SPA pivot
  await network.cacheAuthToken();
  const isTrigger = input.diagnostics.dashboardStrategy === 'TRIGGER';
  if (isTrigger) await triggerDashboardUi(mediator);
  // Build API context AFTER trigger — captures endpoint template from SPA traffic
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value);
  return succeed({ ...input, api: some(apiCtx) });
}

export { executeDashboardAction };
