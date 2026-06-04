/**
 * AUTH-DISCOVERY phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * <p>Phase 2d strict-cluster split: telemetry + snapshot helpers
 * moved to {@link ./AuthDiscoveryTelemetry.ts}; the FINAL dashboard
 * gate orchestrator moved to {@link ./AuthDiscoveryFinal.ts}. This
 * entry-point file now owns only the PRE/ACTION/POST stages plus
 * the public re-export surface every consumer imports from.
 *
 * <p>Mirror of ACCOUNT-RESOLVE phase shape: PRE inventories the
 * surface, ACTION is a sealed pass-through (no mediator there), POST
 * does the real collection + validation work, FINAL emits the slim
 * {@link IAuthDiscovery} value-typed contract onto `ctx.authDiscovery`.
 */

import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IAuthDiscovery,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { AUTH_DISCOVERY_PRE_SETTLE_MS } from '../Timing/TimingConfig.js';
import {
  auditSessionCookies,
  collectAuthChannels,
  probeDashboardSignal,
} from './AuthDiscoveryProbes.js';
import { buildAndLogSnapshot, failAuthDiscovery } from './AuthDiscoveryTelemetry.js';

/** Fail-loud reason emitted when the session-cookie audit observes zero cookies. */
const AUTH_POST_COOKIES_EMPTY_REASON = 'cookies=0 after auth';

/**
 * Wrap the single-fail-code "cookies missing after auth" branch.
 * @returns Pre-built fail Procedure for the cookies-empty branch.
 */
function failCookiesEmpty(): Procedure<IPipelineContext> {
  return failAuthDiscovery('AUTH_DISCOVERY_SESSION_INVALID', AUTH_POST_COOKIES_EMPTY_REASON);
}

/**
 * Wait up to {@link AUTH_DISCOVERY_PRE_SETTLE_MS} for the SPA's
 * network to go idle. Event-driven via `waitForNetworkIdle`.
 * @param mediator - Element mediator (provides the wait primitive).
 * @returns True after the wait settles or the budget elapses.
 */
async function settlePostLoginRedirect(mediator: IElementMediator): Promise<true> {
  await mediator.waitForNetworkIdle(AUTH_DISCOVERY_PRE_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Inventory the captured-network pool and emit one telemetry event
 * naming the count.
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
 * PRE — passive inventory after a settle wait. Gives the SPA time
 * to flush post-login redirect chatter so the inventory it reads
 * reflects the final post-login state.
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
 * @param input - Sealed action context.
 * @returns Pass-through success.
 */
function executeAuthDiscoveryAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  const passThrough = succeed(input);
  return Promise.resolve(passThrough);
}

/**
 * Build the LOGIN.POST success-step Procedure: clones the input
 * with the slim {@link IAuthDiscovery} snapshot pinned onto
 * `authDiscovery`.
 * @param input - Pipeline context entering AUTH-DISCOVERY POST.
 * @param snapshot - Slim snapshot built from the collected channels.
 * @returns Success Procedure wrapping the updated context.
 */
function commitAuthDiscovery(
  input: IPipelineContext,
  snapshot: IAuthDiscovery,
): Procedure<IPipelineContext> {
  return succeed({ ...input, authDiscovery: some(snapshot) });
}

/**
 * Collect the live AUTH-DISCOVERY channels (token + dashboard reveal),
 * build the slim snapshot, and emit the POST-validated telemetry line.
 * @param input - Pipeline context.
 * @param mediator - Live element mediator from the POST gate.
 * @param cookieNames - Cookie names from the session-cookie audit.
 * @returns Freshly built {@link IAuthDiscovery} snapshot.
 */
async function collectAuthDiscoverySnapshot(
  input: IPipelineContext,
  mediator: IElementMediator,
  cookieNames: readonly string[],
): Promise<IAuthDiscovery> {
  const channels = await collectAuthChannels(mediator.network);
  const reveal = await probeDashboardSignal(mediator);
  return buildAndLogSnapshot({ input, channels, reveal, cookieNames });
}

/** Result of {@link gateAuthDiscoveryPost} — proceed or short-circuit. */
type PostGate =
  | { readonly tag: 'go'; readonly mediator: IElementMediator }
  | { readonly tag: 'short'; readonly proc: Procedure<IPipelineContext> };

/**
 * Gate AUTH-DISCOVERY POST entry: short-circuits with pass-through
 * success when no mediator is attached; otherwise yields the live
 * mediator for the POST workflow.
 * @param input - Pipeline context.
 * @returns Tagged result — `'go'` carries the mediator, `'short'`
 *   carries the Procedure the caller should return verbatim.
 */
function gateAuthDiscoveryPost(input: IPipelineContext): PostGate {
  if (!input.mediator.has) return { tag: 'short', proc: succeed(input) };
  return { tag: 'go', mediator: input.mediator.value };
}

/**
 * POST — collect auth channels + dashboard reveal + cookie audit.
 * Builds the slim {@link IAuthDiscovery} value and commits it to
 * `ctx.authDiscovery` on success. Fails loud
 * `AUTH_DISCOVERY_SESSION_INVALID` only when cookies are empty.
 * @param input - Pipeline context.
 * @returns Updated context with `authDiscovery` populated, or
 *   the single-fail-code procedure when cookies were missing.
 */
async function executeAuthDiscoveryPost(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const gate = gateAuthDiscoveryPost(input);
  if (gate.tag === 'short') return gate.proc;
  const cookieAudit = await auditSessionCookies(gate.mediator);
  if (cookieAudit.count === 0) return failCookiesEmpty();
  const snapshot = await collectAuthDiscoverySnapshot(input, gate.mediator, cookieAudit.names);
  return commitAuthDiscovery(input, snapshot);
}

export { AUTH_DISCOVERY_DASHBOARD_WAIT_MS } from '../Timing/TimingConfig.js';
export { executeAuthDiscoveryFinal } from './AuthDiscoveryFinal.js';
export { executeAuthDiscoveryAction, executeAuthDiscoveryPost, executeAuthDiscoveryPre };
