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
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

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
  logger?.debug({ sessionFound: hasDiscovered });
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
 * Race the change-password probe candidates with a short timeout.
 * Catches resolveVisible failures (closed page, mock errors) so the
 * caller treats them as "no prompt found".
 * @param mediator - Element mediator.
 * @returns Race result or false on probe error.
 */
async function probeChangePwdRace(mediator: IElementMediator): Promise<IRaceResult | false> {
  const candidates = WK_DASHBOARD.CHANGE_PWD as unknown as readonly SelectorCandidate[];
  return mediator.resolveVisible(candidates, CHANGE_PWD_TIMEOUT).catch((): false => false);
}

/**
 * Probe the dashboard-success markers (balance / logout / last login).
 * A visible change-password marker that COEXISTS with a fully-loaded
 * dashboard is a benign settings/menu link, not a forced-change
 * interstitial — which replaces the dashboard entirely. Shape rule, not
 * bank identity, so it stays decoupled across every pipeline bank.
 * @param mediator - Element mediator.
 * @returns True iff a dashboard-success marker is currently visible.
 */
async function probeDashboardReady(mediator: IElementMediator): Promise<boolean> {
  const candidates = WK_DASHBOARD.SUCCESS as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(candidates, CHANGE_PWD_TIMEOUT)
    .catch((): false => false);
  return result !== false && result.found;
}

/**
 * Check change-password prompt via mediator using WK_DASHBOARD. A marker
 * is only treated as a forced change when the dashboard-success markers
 * are absent (a real forced-change page replaces the dashboard).
 * @param mediator - Element mediator.
 * @returns Failure if password change required, false otherwise.
 */
export default async function checkChangePassword(
  mediator: IElementMediator,
): Promise<Procedure<IPipelineContext> | false> {
  const changePwd = await probeChangePwdRace(mediator);
  if (!changePwd || !changePwd.found) return false;
  const isDashboardReady = await probeDashboardReady(mediator);
  if (isDashboardReady) return false;
  return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
}
