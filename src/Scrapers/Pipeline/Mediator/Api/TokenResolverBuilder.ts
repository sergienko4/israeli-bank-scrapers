/**
 * TokenResolverBuilder — the ONE place that owns the retry
 * ladder for ITokenStrategy-backed resolvers. Produces an
 * ITokenResolver bound to (strategy, bus, ctx, creds) via a
 * closure so ApiMediator can call resolve()/refresh() with
 * no arguments (spec.txt §B.13).
 *
 * Ladder semantics (spec.txt §A.3):
 *   resolve()  runs primeInitial; on fail + warm state, retries
 *              via primeFresh — unless a terminal edge or integrity refusal,
 *              or the strategy's optional mayEscalateWarmFailure, prevents it;
 *              otherwise returns the failure verbatim.
 *   refresh()  always runs primeFresh (invoked by ApiMediator's
 *              retryOn401 wrapper on any 401 mid-session).
 *   recover()  runs primeRecover; bound only when the strategy has
 *              it (ApiMediator's recoverSession falls back to
 *              refresh otherwise).
 */

import type { ITokenBus } from '../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../Types/Domain/TokenContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { isOk, isTerminalFailure } from '../../Types/Procedure.js';
import type { ITokenResolver } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

/** Closure-only deps packed by the builder — never exported. */
interface IBuilderDeps<TCreds> {
  readonly strategy: ITokenStrategy<TCreds>;
  readonly bus: ITokenBus;
  readonly ctx: ITokenContext;
  readonly creds: TCreds;
}

/**
 * Fresh path runner — hoisted so both resolve() and refresh()
 * reuse the same primeFresh call site.
 * @param deps - Closure deps bag.
 * @returns Header-value procedure.
 */
async function runFresh<TCreds>(deps: IBuilderDeps<TCreds>): Promise<Procedure<string>> {
  return deps.strategy.primeFresh(deps.bus, deps.ctx, deps.creds);
}

/**
 * Whether a failed stored-token attempt may escalate to primeFresh.
 * A WAF block is terminal: the edge refused the request before the bank saw
 * it, so a cold login would hit the same edge and could spend an SMS OTP.
 * Integrity refusals also stop escalation. A strategy may narrow it further;
 * one without the hook escalates as before.
 * @param first - The failed primeInitial outcome.
 * @param deps - Closure deps bag.
 * @returns True when warm state exists, the failure is not terminal and the
 *   strategy lets this failure escalate.
 */
function canEscalate<TCreds>(first: IProcedureFailure, deps: IBuilderDeps<TCreds>): boolean {
  if (isTerminalFailure(first)) return false;
  if (!deps.strategy.hasWarmState(deps.creds)) return false;
  return deps.strategy.mayEscalateWarmFailure?.(first) ?? true;
}

/**
 * Prime ladder — stored-first, fresh-fallback when a warm state
 * was supplied. Preserves rev11 belt-and-suspenders semantic
 * (spec.txt §A.3: "Stored path failure + warm state → ONE
 * retry via primeFresh"), except after a terminal refusal.
 * @param deps - Closure deps bag.
 * @returns Header-value procedure.
 */
async function runInitial<TCreds>(deps: IBuilderDeps<TCreds>): Promise<Procedure<string>> {
  const first = await deps.strategy.primeInitial(deps.bus, deps.ctx, deps.creds);
  if (isOk(first)) return first;
  if (!canEscalate(first, deps)) return first;
  return runFresh(deps);
}

/** Args bundle for buildResolverFromStrategy — satisfies the 3-param cap. */
interface IBuildResolverArgs<TCreds> {
  readonly strategy: ITokenStrategy<TCreds>;
  readonly bus: ITokenBus;
  readonly ctx: ITokenContext;
  readonly creds: TCreds;
}

/**
 * Curry-bind the resolve+refresh pair over closure deps so the parent
 * builder body stays under the 10-LoC cap.
 * @param deps - Closure deps bag.
 * @returns Pick of ITokenResolver with bound resolve and refresh fns.
 */
function bindResolverPair<TCreds>(
  deps: IBuilderDeps<TCreds>,
): Pick<ITokenResolver, 'resolve' | 'refresh'> {
  /**
   * Resolve curried over closure deps — runs the prime ladder.
   * @returns Header-value procedure from primeInitial with fresh fallback.
   */
  const resolve = (): Promise<Procedure<string>> => runInitial(deps);
  /**
   * Refresh curried over closure deps — runs the fresh path directly.
   * @returns Header-value procedure from primeFresh.
   */
  const refresh = (): Promise<Procedure<string>> => runFresh(deps);
  return { resolve, refresh };
}

/**
 * Bind recover() to the strategy's primeRecover, when it has one.
 * @param deps - Closure deps bag.
 * @returns A bound recover, or nothing when the strategy cannot re-grant.
 */
function bindRecover<TCreds>(deps: IBuilderDeps<TCreds>): Pick<ITokenResolver, 'recover'> {
  const { strategy } = deps;
  if (!strategy.primeRecover) return {};
  const primeRecover = strategy.primeRecover.bind(strategy);
  /**
   * Recover curried over closure deps — runs the strategy's re-grant.
   * @returns Header-value procedure from primeRecover.
   */
  const recover = (): Promise<Procedure<string>> => primeRecover(deps.bus, deps.ctx, deps.creds);
  return { recover };
}

/**
 * Wire a token strategy + deps into a bound ITokenResolver.
 * @param args - Strategy + bus + ctx + creds bundle.
 * @returns Bound token resolver.
 */
function buildResolverFromStrategy<TCreds>(args: IBuildResolverArgs<TCreds>): ITokenResolver {
  const deps: IBuilderDeps<TCreds> = {
    strategy: args.strategy,
    bus: args.bus,
    ctx: args.ctx,
    creds: args.creds,
  };
  return { name: args.strategy.name, ...bindResolverPair(deps), ...bindRecover(deps) };
}

export default buildResolverFromStrategy;
export { buildResolverFromStrategy };
export type { IBuildResolverArgs };
