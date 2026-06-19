/**
 * Dashboard probes — WK_DASHBOARD selector resolution via mediator.
 * Phases call these functions instead of importing WK directly.
 */

import { randomUUID } from 'node:crypto';

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
const DASHBOARD_PROBE_ERROR = 'DASHBOARD_PROBE_ERROR: change-password probe failed';

/** Logging inputs for forced-password detection. */
interface IDashboardProbeLogContext {
  readonly logger: ScraperLogger;
  readonly companyId: string;
}

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
 * @param mediator - Element mediator.
 * @returns Race result or typed probe failure.
 */
async function probeChangePwdRace(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  const candidates = WK_DASHBOARD.CHANGE_PWD as unknown as readonly SelectorCandidate[];
  try {
    return succeed(await mediator.resolveVisible(candidates, CHANGE_PWD_TIMEOUT));
  } catch {
    return fail(ScraperErrorTypes.Generic, DASHBOARD_PROBE_ERROR);
  }
}

/**
 * Emits a PII-safe forced-password warning.
 * @param context - Optional structured logging context.
 * @returns Always true.
 */
function logForcedPassword(context?: IDashboardProbeLogContext): true {
  context?.logger.warn({
    event: 'dashboard.forced_password.detected',
    companyId: context.companyId,
    correlationId: randomUUID(),
    marker: true,
  });
  return true;
}

/**
 * Build the forced-password Procedure after logging the guardrail event.
 * @param context - Optional structured logging context.
 * @returns Change-password failure.
 */
function failForcedPassword(context?: IDashboardProbeLogContext): Procedure<IPipelineContext> {
  logForcedPassword(context);
  return fail(ScraperErrorTypes.ChangePassword, 'Password change required');
}

/**
 * Check change-password prompt via mediator using WK_DASHBOARD.
 * @param mediator - Element mediator.
 * @param logContext - Optional PII-safe logging context.
 * @returns Failure if password change required, false otherwise.
 */
export default async function checkChangePassword(
  mediator: IElementMediator,
  logContext?: IDashboardProbeLogContext,
): Promise<Procedure<IPipelineContext> | false> {
  const changePwd = await probeChangePwdRace(mediator);
  if (!changePwd.success) return changePwd;
  if (changePwd.value.found) return failForcedPassword(logContext);
  return false;
}
