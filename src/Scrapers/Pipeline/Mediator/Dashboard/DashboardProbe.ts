/**
 * Dashboard probes — WK_DASHBOARD selector resolution via mediator.
 * Phases call these functions instead of importing WK directly.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

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
