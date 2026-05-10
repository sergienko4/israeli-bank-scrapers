/**
 * AUTH-DISCOVERY phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * Mission 1 of the CI quality hardening plan. Single source of truth
 * for "we are authenticated AND on the dashboard". Replaces the
 * scattered work previously living in LOGIN.FINAL (LoginSignalProbe)
 * and OTP-FILL.PRE (maybeFastPathSuccess); LOGIN/OTP-FILL/OTP-TRIGGER
 * are sealed in Missions 2/3/4.
 *
 * <p>Mirror of ACCOUNT-RESOLVE phase shape: PRE inventories the
 * surface, ACTION is a sealed pass-through (no mediator there), POST
 * does the real collection + validation work, FINAL emits the slim
 * {@link IAuthDiscovery} value-typed contract onto `ctx.authDiscovery`.
 *
 * <p>Ownership rules (R-AUTH-DISCOVERY-OWN):
 * <ul>
 *   <li>This file is the ONLY phase-mediator outside of the Dashboard
 *       zone allowlist that calls `probeDashboardReveal` (via the
 *       wrapping helper in {@link AuthDiscoveryProbes}).</li>
 *   <li>This file is the SINGLE production caller of
 *       `discoverAuthToken`, `discoverOrigin`, `discoverSiteId`,
 *       `buildDiscoveredHeaders` outside of `Mediator/Network/`
 *       (defines them) and the existing Dashboard-zone callers
 *       (allowlisted, tightening tracked in plan §O-4).</li>
 * </ul>
 *
 * <p>POST fail-loud strategy for M1: only fail on
 * `AUTH_DISCOVERY_SESSION_INVALID` (cookieCount === 0) — matches the
 * existing LOGIN.FINAL behaviour exactly so M1 introduces zero new
 * failure modes for happy-path runs. M2 deletes LoginSignalProbe and
 * the strict cookie check moves into AUTH-DISCOVERY only.
 * `AUTH_DISCOVERY_DASHBOARD_NOT_READY` and
 * `AUTH_DISCOVERY_TOKEN_REQUIRED_AND_MISSING` ride as enum values for
 * future tightening; the slim emit carries `dashboardReady` and
 * `authToken` as data so consumers (DASHBOARD/SCRAPE) decide.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import type {
  AuthDiscoveryFailCode,
  IActionContext,
  IAuthDiscovery,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { AUTH_DISCOVERY_PRE_SETTLE_MS } from '../Timing/TimingConfig.js';
import {
  auditSessionCookies,
  collectAuthChannels,
  probeDashboardSignal,
} from './AuthDiscoveryProbes.js';

/**
 * MOCK_MODE safety valve — lets AUTH-DISCOVERY skip its network-
 * driven probes for the offline snapshot suite, which has no
 * captured traffic. Read every call (rather than module-scope const)
 * so unit tests can flip the env var per test case.
 *
 * @returns True when MOCK_MODE selects the offline snapshot bypass.
 */
function isMockModeAuthDiscoveryActive(): boolean {
  return process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';
}

/**
 * Wait up to {@link AUTH_DISCOVERY_PRE_SETTLE_MS} for the SPA's
 * network to go idle. Event-driven via `waitForNetworkIdle` —
 * exits the moment idle is detected (fast banks pay 0 ms; slow-
 * redirect banks pay up to the ceiling). Single-purpose helper so
 * `executeAuthDiscoveryPre` can stay a thin orchestrator and keep
 * within the project's 10-line ceiling.
 *
 * @param mediator - Element mediator (provides the wait primitive).
 * @returns True after the wait settles or the budget elapses.
 */
async function settlePostLoginRedirect(mediator: IElementMediator): Promise<true> {
  await mediator.waitForNetworkIdle(AUTH_DISCOVERY_PRE_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Inventory the captured-network pool and emit one telemetry event
 * naming the count. Single-purpose so `executeAuthDiscoveryPre`
 * does not mix telemetry with control flow.
 *
 * @param input - Pipeline context (logger handle).
 * @param captureCount - Pool size at PRE entry.
 * @returns True after the event is emitted.
 */
function logInventory(input: IPipelineContext, captureCount: number): true {
  input.logger.debug({
    event: 'auth-discovery.pre.inventory',
    message: `auth-discovery.pre captures=${String(captureCount)}`,
  });
  return true;
}

/**
 * PRE — passive inventory after a settle wait. Gives the SPA up to
 * {@link AUTH_DISCOVERY_PRE_SETTLE_MS} ms to flush post-login
 * redirect chatter (auth-token endpoints, header-bearer fetches,
 * redirect navigation) so the inventory it reads reflects the final
 * post-login state, not a mid-redirect snapshot. Logs an entry-state
 * telemetry event so the live `pipeline.log` shows the moment
 * AUTH-DISCOVERY took over from auth (LOGIN or OTP-FILL).
 *
 * @param input - Pipeline context.
 * @returns Pass-through success.
 */
async function executeAuthDiscoveryPre(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  await settlePostLoginRedirect(mediator);
  const allEndpoints = mediator.network.getAllEndpoints();
  logInventory(input, allEndpoints.length);
  return succeed(input);
}

/**
 * ACTION — sealed pass-through (no mediator on `IActionContext`).
 * The real probe runs in POST where the mediator is reachable again.
 * Required override for the BasePhase template.
 *
 * @param input - Sealed action context.
 * @returns Pass-through success.
 */
function executeAuthDiscoveryAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  const passThrough = succeed(input);
  return Promise.resolve(passThrough);
}

/**
 * POST — collect auth channels + dashboard reveal + cookie audit.
 * Builds the slim {@link IAuthDiscovery} value and commits it to
 * `ctx.authDiscovery` on success. Fails loud
 * `AUTH_DISCOVERY_SESSION_INVALID` only when cookies are empty;
 * other channels (token, dashboardReady) travel as data.
 *
 * @param input - Pipeline context.
 * @returns Updated context with `authDiscovery` populated, or
 *   the single-fail-code procedure when cookies were missing.
 */
async function executeAuthDiscoveryPost(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  if (isMockModeAuthDiscoveryActive()) return succeed(input);
  const mediator = input.mediator.value;
  const cookieAudit = await auditSessionCookies(mediator);
  if (cookieAudit.count === 0) {
    return failAuthDiscovery('AUTH_DISCOVERY_SESSION_INVALID', 'cookies=0 after auth');
  }
  const channels = await collectAuthChannels(mediator.network);
  const reveal = await probeDashboardSignal(mediator);
  const snapshot = buildSnapshot(channels, reveal.dashboardReady, cookieAudit.names);
  logPostValidated(input, snapshot, reveal.revealString);
  return succeed({ ...input, authDiscovery: some(snapshot) });
}

/**
 * Build the slim {@link IAuthDiscovery} value from the collected
 * inputs. Pure — no side effects.
 * @param channels - Collected auth channels.
 * @param dashboardReady - Result of the reveal probe.
 * @param cookieNames - Session cookie names from the audit.
 * @returns Slim auth discovery snapshot.
 */
function buildSnapshot(
  channels: Awaited<ReturnType<typeof collectAuthChannels>>,
  dashboardReady: boolean,
  cookieNames: readonly string[],
): IAuthDiscovery {
  return {
    authToken: channels.authToken,
    origin: channels.origin,
    siteId: channels.siteId,
    headers: channels.headers,
    dashboardReady,
    sessionCookieNames: cookieNames,
  };
}

/**
 * Emit POST-validated telemetry — PII-safe (booleans + counts only,
 * no header values, no token, no cookie values).
 * @param input - Pipeline context (for the logger handle).
 * @param snapshot - Built snapshot to summarise.
 * @param revealString - Reveal probe result (already mask-safe per
 *   `probeDashboardReveal` contract).
 * @returns True after the event is logged.
 */
function logPostValidated(
  input: IPipelineContext,
  snapshot: IAuthDiscovery,
  revealString: string,
): true {
  input.logger.debug({
    event: 'auth-discovery.post.validated',
    dashboardReady: snapshot.dashboardReady,
    hasAuthToken: snapshot.authToken !== false,
    hasOrigin: snapshot.origin !== false,
    hasSiteId: snapshot.siteId !== false,
    sessionCookieCount: snapshot.sessionCookieNames.length,
    revealString,
  });
  return true;
}

/**
 * Construct a fail-loud Procedure with a structured AUTH-DISCOVERY
 * fail code embedded in the message. The pipeline's existing
 * ScraperErrorTypes.Generic is the carrier — the fail code itself
 * lives in the message so callers can grep for it.
 *
 * @param code - One of the {@link AuthDiscoveryFailCode} enum values.
 * @param reason - Short diagnostic string (no PII).
 * @returns Failure Procedure.
 */
function failAuthDiscovery(
  code: AuthDiscoveryFailCode,
  reason: string,
): Procedure<IPipelineContext> {
  const msg = `AUTH-DISCOVERY POST: ${code} — ${reason}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * FINAL — emit the `auth-discovery.committed` event for live runs.
 * The slim snapshot was already committed by POST; FINAL is the
 * canonical telemetry hook so a single PII-safe summary line lands
 * in `pipeline.log` per run.
 *
 * @param input - Pipeline context.
 * @returns Pass-through success.
 */
function executeAuthDiscoveryFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.authDiscovery.has) {
    const passThrough = succeed(input);
    return Promise.resolve(passThrough);
  }
  const snap = input.authDiscovery.value;
  input.logger.debug({
    event: 'auth-discovery.committed',
    dashboardReady: snap.dashboardReady,
    hasAuthToken: snap.authToken !== false,
    hasOrigin: snap.origin !== false,
    hasSiteId: snap.siteId !== false,
    sessionCookieCount: snap.sessionCookieNames.length,
  });
  const passThrough = succeed(input);
  return Promise.resolve(passThrough);
}

export { AUTH_DISCOVERY_DASHBOARD_WAIT_MS } from '../Timing/TimingConfig.js';
export {
  executeAuthDiscoveryAction,
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
};
