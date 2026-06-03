/**
 * DASHBOARD POST phase orchestration — change-password check + simple
 * traffic-presence gate.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IDashboardState, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { validateTrafficGate } from './DashboardDiscovery.js';
import { clickAtForLog } from './DashboardPhaseActions.winners.js';
import checkChangePassword from './DashboardProbe.js';

/** Bundle of POST-time traffic counters used by the delta log. */
interface IPostDelta {
  readonly preNavCount: number;
  readonly postNavCount: number;
  readonly clickAt: number;
}

/**
 * Read the pre/post-nav capture counts + the masked click timestamp.
 * @param network - Network discovery handle.
 * @returns Bundle of counts + clickAt for the delta log.
 */
function readPostDelta(network: IElementMediator['network']): IPostDelta {
  const preNavCount = network.getPreNavCaptures().length;
  const postNavCount = network.getPostNavCaptures().length;
  const rawClickAt = network.getDashboardClickAt();
  return { preNavCount, postNavCount, clickAt: clickAtForLog(rawClickAt) };
}

/**
 * Emit the `dashboard.post.delta` log event for {@link executeValidateTraffic}.
 * @param input - Pipeline context with logger.
 * @param delta - Pre-built delta bundle.
 * @returns Always true so the caller stays expression-shaped.
 */
function logPostDelta(input: IPipelineContext, delta: IPostDelta): true {
  input.logger.debug({ event: 'dashboard.post.delta', ...delta });
  return true;
}

/**
 * Read the post-nav delta off the mediator's network and emit the
 * structured log event.
 * @param input - Pipeline context with logger.
 * @param mediator - Element mediator (already unwrapped).
 * @returns Always true so the caller stays expression-shaped.
 */
function emitPostDeltaFromMediator(input: IPipelineContext, mediator: IElementMediator): true {
  const delta = readPostDelta(mediator.network);
  return logPostDelta(input, delta);
}

/**
 * Build the success-branch dashboard state for {@link executeValidateTraffic}.
 * @param pageUrl - Current URL captured at POST time.
 * @returns Ready dashboard state with traffic primed.
 */
function buildDashState(pageUrl: string): IDashboardState {
  return { isReady: true, pageUrl, trafficPrimed: true };
}

/**
 * Run the password-change probe + the primed-traffic gate.
 * @param mediator - Element mediator (already unwrapped).
 * @param input - Pipeline context (for logger access).
 * @returns Fail procedure when pwd flagged; otherwise the primed gate bit.
 */
async function runPwdAndPrime(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | boolean> {
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  return validateTrafficGate(mediator.network, input.logger);
}

/**
 * Read the current URL + emit the POST primed log line.
 * @param input - Pipeline context (for logger access).
 * @param mediator - Element mediator (already unwrapped).
 * @param primed - Result of the traffic-gate probe.
 * @returns Current page URL captured at POST time.
 */
function logPrimedAndReadUrl(
  input: IPipelineContext,
  mediator: IElementMediator,
  primed: boolean,
): string {
  const pageUrl = mediator.getCurrentUrl();
  input.logger.debug({ primed, url: maskVisibleText(pageUrl) });
  return pageUrl;
}

/**
 * Build the success procedure for the primed-traffic branch.
 * Pulled out so {@link finalizePrimedTraffic} stays under the LoC cap.
 * @param input - Pipeline context.
 * @param pageUrl - Current URL captured at POST time.
 * @returns Procedure carrying the committed dashboard state.
 */
function buildPrimedSuccess(input: IPipelineContext, pageUrl: string): Procedure<IPipelineContext> {
  const dashState = buildDashState(pageUrl);
  const dashboard = some(dashState);
  return succeed({ ...input, dashboard });
}

/**
 * Tail of {@link executeValidateTraffic} that runs after PWD priming
 * settles. Either fails loud or commits the assembled dashboard state.
 * @param input - Pipeline context.
 * @param mediator - Unwrapped mediator (caller-side narrowed).
 * @param primed - Whether PWD priming captured txn-shape traffic.
 * @returns Procedure with the committed dashboard state, or a failure.
 */
function finalizePrimedTraffic(
  input: IPipelineContext,
  mediator: IElementMediator,
  primed: boolean,
): Procedure<IPipelineContext> {
  const pageUrl = logPrimedAndReadUrl(input, mediator, primed);
  emitPostDeltaFromMediator(input, mediator);
  if (!primed) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no API traffic hasTxn');
  return buildPrimedSuccess(input, pageUrl);
}

/**
 * POST: Change-password check + simple traffic gate (HEAD-equivalent).
 * @param input - Pipeline context.
 * @returns Updated context with dashboard state.
 */
async function executeValidateTraffic(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no mediator');
  const mediator = input.mediator.value;
  const primedOrFail = await runPwdAndPrime(mediator, input);
  if (typeof primedOrFail !== 'boolean') return primedOrFail;
  return finalizePrimedTraffic(input, mediator, primedOrFail);
}

export default executeValidateTraffic;
export { executeValidateTraffic };
