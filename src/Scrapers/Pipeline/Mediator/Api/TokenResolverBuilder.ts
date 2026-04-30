/**
 * TokenResolverBuilder — the ONE place that owns the retry
 * ladder for ITokenStrategy-backed resolvers. Produces an
 * ITokenResolver bound to (strategy, bus, ctx, creds) via a
 * closure so ApiMediator can call resolve()/refresh() with
 * no arguments (spec.txt §B.13).
 *
 * Ladder semantics (spec.txt §A.3):
 *   resolve()  runs primeInitial; on fail + warm state, retries
 *              via primeFresh; else returns the failure verbatim.
 *   refresh()  always runs primeFresh (invoked by ApiMediator's
 *              retryOn401 wrapper on any 401 mid-session).
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import type { IApiMediator } from './ApiMediator.js';
import type { AuthorizationHeaderValue, ITokenResolver } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

/** Closure-only deps packed by the builder — never exported. */
interface IBuilderDeps<TCreds> {
  readonly strategy: ITokenStrategy<TCreds>;
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly creds: TCreds;
}

/**
 * Fresh path runner — hoisted so both resolve() and refresh()
 * reuse the same primeFresh call site.
 * @param deps - Closure deps bag.
 * @returns Header-value procedure.
 */
async function runFresh<TCreds>(
  deps: IBuilderDeps<TCreds>,
): Promise<Procedure<AuthorizationHeaderValue>> {
  return deps.strategy.primeFresh(deps.bus, deps.ctx, deps.creds);
}

/**
 * Prime ladder — stored-first, fresh-fallback when a warm state
 * was supplied. Preserves rev11 belt-and-suspenders semantic
 * (spec.txt §A.3: "Stored path failure + warm state → ONE
 * retry via primeFresh").
 * @param deps - Closure deps bag.
 * @returns Header-value procedure.
 */
async function runInitial<TCreds>(
  deps: IBuilderDeps<TCreds>,
): Promise<Procedure<AuthorizationHeaderValue>> {
  const first = await deps.strategy.primeInitial(deps.bus, deps.ctx, deps.creds);
  if (isOk(first)) return first;
  const hasWarm = deps.strategy.hasWarmState(deps.creds);
  if (!hasWarm) return first;
  return runFresh(deps);
}

/** Args bundle for buildResolverFromStrategy — satisfies the 3-param cap. */
interface IBuildResolverArgs<TCreds> {
  readonly strategy: ITokenStrategy<TCreds>;
  readonly bus: IApiMediator;
  readonly ctx: IPipelineContext;
  readonly creds: TCreds;
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
  /**
   * Bound resolve — runs the prime ladder.
   * @returns Header-value procedure.
   */
  function boundResolve(): Promise<Procedure<AuthorizationHeaderValue>> {
    return runInitial(deps);
  }
  /**
   * Bound refresh — runs the fresh path directly.
   * @returns Header-value procedure.
   */
  function boundRefresh(): Promise<Procedure<AuthorizationHeaderValue>> {
    return runFresh(deps);
  }
  return { name: args.strategy.name, resolve: boundResolve, refresh: boundRefresh };
}

export default buildResolverFromStrategy;
export { buildResolverFromStrategy };
export type { IBuildResolverArgs };
