/**
 * The config strategy's in-run re-grant (`primeRecover`).
 *
 * A whole-scrape recovery asks for a new session after the bank rejected the
 * current one. A `carry-bundle` login resumes it the way a warm start does,
 * but from memory: the login cookies an `isolate` hand-off stashed go
 * back into the jar, the private carry seeds the flow, and the flow runs from
 * `fromStepIndex` — no registration, no cold-login budget. Only a resume the
 * `coldFallback` gate lets through escalates to one cold login. Every other
 * warm kind, and every durable session, takes `primeFresh` exactly as before.
 */

import type { ITokenBus } from '../../../../Types/Domain/TokenBus.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk, isTerminalFailure } from '../../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../../ConfigContracts/index.js';
import { mayEscalateWarmFailureImpl } from './TokenStrategyFromConfig.fallback.js';
import { primeFreshImpl, runConfiguredFlow } from './TokenStrategyFromConfig.flow.js';
import { makeWarmArgs } from './TokenStrategyFromConfig.shared.js';
import type { ILongTermTokenSlot, IPrimeArgs } from './TokenStrategyFromConfig.types.js';

/** One way to re-grant a rejected session. */
type RecoverRoute = (args: IPrimeArgs) => Promise<Procedure<string>>;

/** A configured warm-start kind, or `none` when the config has no warm start. */
type WarmKind = NonNullable<NonNullable<IApiDirectCallConfig['warmStart']>['kind']> | 'none';

/**
 * Put the login's cookies back before the resume: the scrape's own cookies
 * are dropped (the scrape re-runs from its bootstrap). A `shared` hand-off
 * stashed nothing, so its jar already holds the login cookies.
 * @param bus - Token bus whose jar the resume sends.
 * @param slot - Capture slot holding the stash.
 * @returns How many stashed cookies went back; 0 when none were stashed.
 */
function restoreLoginJar(bus: ITokenBus, slot: ILongTermTokenSlot): number {
  const stash = slot.handoffCookies;
  const jar = bus.cookies;
  if (stash === undefined || jar === undefined) return 0;
  jar.clear();
  return jar.importAll(stash);
}

/**
 * Resume the session from `fromStepIndex` on the private carry.
 * @param args - Prime args.
 * @returns The resumed flow's header value, or its failure.
 */
async function resumeSession(args: IPrimeArgs): Promise<Procedure<string>> {
  const { config, bus, ctx, creds, slot } = args;
  restoreLoginJar(bus, slot);
  const initialCarry = slot.latestCarrySnapshot;
  const warmSpec = { config, bus, creds, companyId: ctx.companyId, initialCarry };
  const resumeArgs = makeWarmArgs(warmSpec);
  return runConfiguredFlow(resumeArgs, slot);
}

/**
 * Resume a carry-bundle session; escalate to one cold login only when the
 * config's `coldFallback` gate lets the resume's non-terminal failure through.
 * @param args - Prime args.
 * @returns The new header value, or the failure.
 */
async function resumeCarryBundle(args: IPrimeArgs): Promise<Procedure<string>> {
  const resumed = await resumeSession(args);
  args.slot.lastMintResumed = resumed.success;
  if (isOk(resumed)) return resumed;
  if (isTerminalFailure(resumed)) return resumed;
  const canEscalate = mayEscalateWarmFailureImpl(args.config, resumed);
  if (!canEscalate) return resumed;
  return primeFreshImpl(args);
}

/** The re-grant each warm kind takes; a new kind must name its own. */
const RECOVER_ROUTES: Readonly<Record<WarmKind, RecoverRoute>> = {
  none: primeFreshImpl,
  carry: primeFreshImpl,
  'cookie-jar': primeFreshImpl,
  'carry-bundle': resumeCarryBundle,
};

/**
 * The config's warm-start kind; a carry warm start leaves `kind` out.
 * @param config - Call config.
 * @returns The warm kind, or `none`.
 */
function warmKindOf(config: IApiDirectCallConfig): WarmKind {
  const warm = config.warmStart;
  if (warm === undefined) return 'none';
  return warm.kind ?? 'carry';
}

/**
 * Re-grant a rejected session in-run. A durable session never resumes
 * here — `primeFresh` refuses it, as before.
 * @param args - Prime args.
 * @returns The new header value, or the failure.
 */
async function primeRecoverImpl(args: IPrimeArgs): Promise<Procedure<string>> {
  if (args.slot.persistentAuth !== undefined) return primeFreshImpl(args);
  const kind = warmKindOf(args.config);
  const route = RECOVER_ROUTES[kind];
  return route(args);
}

export default primeRecoverImpl;
export { primeRecoverImpl };
