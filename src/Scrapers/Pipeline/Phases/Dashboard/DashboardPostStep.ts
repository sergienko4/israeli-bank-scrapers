/**
 * Dashboard POST step — change-password check, traffic gate, state build.
 * Extracted from DashboardActions.ts to respect max-lines.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { countTxnTraffic } from '../../Strategy/DashboardDiscoveryStep.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import type { IDashboardState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

const LOG = createLogger('dashboard-post');
type IsMatch = boolean;

/**
 * Validate traffic hard-gate.
 * @param input - Pipeline context.
 * @returns Succeed or fail if UNPRIMED.
 */
function validateTrafficGate(input: IPipelineContext): Procedure<void> {
  const isTrigger = input.diagnostics.dashboardStrategy === 'TRIGGER';
  if (!isTrigger) return succeed(undefined);
  if (!input.mediator.has) return succeed(undefined);
  const hasProxy: IsMatch = Boolean(input.config.auth.loginReqName);
  const traffic = countTxnTraffic(input.mediator.value.network, 0);
  LOG.debug('[POST] traffic=%d proxy=%s', traffic, hasProxy);
  if (traffic === 0 && !hasProxy) return fail(ScraperErrorTypes.Generic, 'DASHBOARD UNPRIMED');
  return succeed(undefined);
}

/**
 * Check change-password prompt via mediator.
 * @param mediator - Element mediator.
 * @returns Failure if password change required, false otherwise.
 */
async function checkChangePassword(
  mediator: IElementMediator,
): Promise<Procedure<IPipelineContext> | false> {
  const changePwd = await mediator.resolveAndClick(WK_DASHBOARD.CHANGE_PWD);
  if (!changePwd.success) return changePwd;
  if (changePwd.value.found)
    return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
  return false;
}

/**
 * Build dashboard state after all gates pass.
 * @param input - Pipeline context.
 * @param mediator - Element mediator.
 * @returns Updated context with dashboard state.
 */
function buildDashState(
  input: IPipelineContext,
  mediator: IElementMediator,
): Procedure<IPipelineContext> {
  const pageUrl = mediator.getCurrentUrl();
  const dashState: IDashboardState = { isReady: true, pageUrl };
  return succeed({ ...input, dashboard: some(dashState) });
}

/**
 * Execute POST: validate traffic + check change-password + store state.
 * @param input - Pipeline context with mediator.
 * @returns Updated context or hard failure.
 */
async function executeDashboardPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for DASHBOARD POST');
  const mediator = input.mediator.value;
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  const gateResult = validateTrafficGate(input);
  if (!gateResult.success) return gateResult;
  return buildDashState(input, mediator);
}

export default executeDashboardPost;
export { executeDashboardPost };
