/**
 * Dashboard probes — WK_DASHBOARD selector resolution via mediator.
 * Phases call these functions instead of importing WK directly.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Timeout for change-password probe (ms). */
const CHANGE_PWD_TIMEOUT = 3000;

/**
 * Check change-password prompt via passive probe (Rule #20: POST is read-only).
 * Uses resolveVisible — no click, no DOM mutation.
 * @param mediator - Element mediator.
 * @returns Failure if password change required, false otherwise.
 */
/**
 * Extract auth token from mediator (iframe sessionStorage + headers).
 * Called by DASHBOARD.FINAL — stores result in diagnostics for SCRAPE.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Procedure with token or false.
 */
async function extractDashboardAuth(
  mediator: IElementMediator,
  logger?: ScraperLogger,
): Promise<Procedure<string | false>> {
  const discovered = await mediator.network.discoverAuthToken();
  const result = discovered || false;
  const hasDiscovered = Boolean(result);
  logger?.debug({ event: 'dashboard-auth', sessionFound: hasDiscovered });
  return succeed(result);
}

/**
 * Extract auth from pipeline context — guards mediator existence.
 * @param input - Pipeline context.
 * @returns Token or false.
 */
async function extractAuthFromContext(input: IPipelineContext): Promise<string | false> {
  if (!input.mediator.has) return false;
  const result = await extractDashboardAuth(input.mediator.value, input.logger);
  if (!result.success) return false;
  return result.value;
}

export { extractAuthFromContext, extractDashboardAuth };

/**
 * Check change-password prompt via mediator using WK_DASHBOARD.
 * @param mediator - Element mediator.
 * @returns Failure if password change required, false otherwise.
 */
export default async function checkChangePassword(
  mediator: IElementMediator,
): Promise<Procedure<IPipelineContext> | false> {
  const candidates = WK_DASHBOARD.CHANGE_PWD as unknown as readonly SelectorCandidate[];
  const changePwd = await mediator
    .resolveVisible(candidates, CHANGE_PWD_TIMEOUT)
    .catch((): false => false);
  if (changePwd && changePwd.found) {
    return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
  }
  return false;
}
