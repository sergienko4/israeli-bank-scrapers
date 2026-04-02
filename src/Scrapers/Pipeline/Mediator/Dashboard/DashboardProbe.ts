/**
 * Dashboard probes — WK_DASHBOARD selector resolution via mediator.
 * Phases call these functions instead of importing WK directly.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/**
 * Check change-password prompt via mediator using WK_DASHBOARD.
 * @param mediator - Element mediator.
 * @returns Failure if password change required, false otherwise.
 */
/** Auth tag lookup for trace logging. */
const AUTH_RESULT: Record<string, string> = { true: 'FOUND', false: 'NONE' };

/**
 * Extract auth token from mediator (iframe sessionStorage + headers).
 * Called by DASHBOARD.FINAL — stores result in diagnostics for SCRAPE.
 * @param mediator - Element mediator.
 * @returns Procedure with token or false.
 */
async function extractDashboardAuth(
  mediator: IElementMediator,
): Promise<Procedure<string | false>> {
  const token = await mediator.network.discoverAuthToken();
  const result = token || false;
  const hasToken = Boolean(result);
  const tag = AUTH_RESULT[String(hasToken)];
  process.stderr.write(`    [DASHBOARD.FINAL] auth=${tag}\n`);
  return succeed(result);
}

/**
 * Extract auth from pipeline context — guards mediator existence.
 * @param input - Pipeline context.
 * @returns Token or false.
 */
async function extractAuthFromContext(input: IPipelineContext): Promise<string | false> {
  if (!input.mediator.has) return false;
  const result = await extractDashboardAuth(input.mediator.value);
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
  const changePwd = await mediator.resolveAndClick(candidates);
  if (!changePwd.success) return changePwd;
  if (changePwd.value.found)
    return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
  return false;
}
