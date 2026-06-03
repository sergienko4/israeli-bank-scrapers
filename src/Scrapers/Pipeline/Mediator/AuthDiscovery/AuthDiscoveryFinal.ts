/**
 * AUTH-DISCOVERY FINAL stage — dashboard gate + commit telemetry.
 *
 * <p>Co-located with {@link ./AuthDiscoveryActions.ts} (Phase 2d
 * strict-cluster split). Runs the M4.F1 two-signal dashboard gate
 * after a settle wait, then either emits the committed telemetry
 * or fails loud `AUTH_DISCOVERY_DASHBOARD_NOT_READY`.
 */

import type { IAuthDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { AUTH_DISCOVERY_FINAL_SETTLE_MS } from '../Timing/TimingConfig.js';
import type { DashboardGateReason } from './AuthDiscoveryInterstitial.js';
import { dashboardGateReason } from './AuthDiscoveryInterstitial.js';
import { emitCommittedTelemetry, failAuthDiscovery } from './AuthDiscoveryTelemetry.js';

/**
 * Resolve the current page URL via the element mediator — empty
 * string when no mediator (mock runs).
 *
 * @param input - Pipeline context.
 * @returns Current URL or `''` when no live page.
 */
function readCurrentUrl(input: IPipelineContext): string {
  if (!input.mediator.has) return '';
  return input.mediator.value.getCurrentUrl();
}

/**
 * Read the pre-auth URL from the LATEST auth-ladder phase emit.
 * Each phase carries `urlBeforeSubmit` on its own slim contract
 * (LOGIN.PRE captures, OTP-TRIGGER + OTP-FILL copy forward). This
 * helper picks the freshest emit so AUTH-DISCOVERY's gate logic
 * does not branch on auth-ladder shape:
 * <ol>
 *   <li>`ctx.otpFill` (always populated when OTP-FILL ran).</li>
 *   <li>`ctx.otpTrigger` (set when OTP-TRIGGER ran).</li>
 *   <li>`ctx.login` (LOGIN's original capture).</li>
 * </ol>
 * Empty string ⇒ no auth-ladder phase ran (test paths only); the
 * predicate then disables the URL gate and decides on REVEAL alone.
 *
 * @param input - Pipeline context.
 * @returns Pre-auth URL value (`''` when no emit).
 */
function readPreAuthUrl(input: IPipelineContext): string {
  if (input.otpFill.has) return input.otpFill.value.urlBeforeSubmit;
  if (input.otpTrigger.has) return input.otpTrigger.value.urlBeforeSubmit;
  if (input.login.has) return input.login.value.urlBeforeSubmit;
  return '';
}

/**
 * Run the M4.F1 dashboard gate against the slim snapshot the POST
 * step committed. Returns the diagnostic enum so the caller can
 * emit a targeted telemetry line. Pure decision — observation only.
 *
 * @param input - Pipeline context.
 * @param snap - Slim auth-discovery snapshot from POST.
 * @returns Gate reason: `'open'` ⇒ commit, otherwise fail-loud reason.
 */
function runDashboardGate(input: IPipelineContext, snap: IAuthDiscovery): DashboardGateReason {
  const currentUrl = readCurrentUrl(input);
  const preAuthUrl = readPreAuthUrl(input);
  return dashboardGateReason(snap, currentUrl, preAuthUrl);
}

/**
 * Wait for the page to settle BEFORE FINAL reads `getCurrentUrl()`,
 * so the URL the gate compares against is the FINAL post-auth URL,
 * not a transient redirect intermediate. Event-driven via
 * `mediator.waitForNetworkIdle` — fast banks pay 0 ms, slow-redirect
 * banks pay up to {@link AUTH_DISCOVERY_FINAL_SETTLE_MS}. No-op when
 * no mediator is attached (test paths).
 *
 * @param input - Pipeline context.
 * @returns True after the wait settles or the budget elapses.
 */
async function settleBeforeGate(input: IPipelineContext): Promise<boolean> {
  if (!input.mediator.has) return false;
  await input.mediator.value
    .waitForNetworkIdle(AUTH_DISCOVERY_FINAL_SETTLE_MS)
    .catch((): false => false);
  return true;
}

/**
 * Decide what FINAL emits given the gate reason: fail loud
 * `AUTH_DISCOVERY_DASHBOARD_NOT_READY` if the gate is closed,
 * otherwise emit the committed telemetry and pass through.
 *
 * @param input - Pipeline context.
 * @param snap - Slim {@link IAuthDiscovery} snapshot from POST.
 * @param reason - Gate decision from {@link runDashboardGate}.
 * @returns Pass-through success, or the dashboard-gate fail.
 */
function decideFinalCommit(
  input: IPipelineContext,
  snap: IAuthDiscovery,
  reason: DashboardGateReason,
): Procedure<IPipelineContext> {
  if (reason !== 'open') return failAuthDiscovery('AUTH_DISCOVERY_DASHBOARD_NOT_READY', reason);
  emitCommittedTelemetry(input, snap);
  return succeed(input);
}

/**
 * FINAL — Mission M4.F1 dashboard gate THEN canonical committed-
 * telemetry emit. Order: settle → gate → commit/fail.
 *
 * @param input - Pipeline context.
 * @returns Pass-through success, or the dashboard-gate fail Procedure.
 */
async function executeAuthDiscoveryFinal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.authDiscovery.has) return succeed(input);
  await settleBeforeGate(input);
  const snap = input.authDiscovery.value;
  const reason = runDashboardGate(input, snap);
  return decideFinalCommit(input, snap, reason);
}

export default executeAuthDiscoveryFinal;
export { executeAuthDiscoveryFinal };
