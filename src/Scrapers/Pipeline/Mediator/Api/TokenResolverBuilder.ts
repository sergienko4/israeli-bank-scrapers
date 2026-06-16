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

import type { ITokenContext } from '../../Types/Domain/TokenContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import type { IApiMediator } from './ApiMediator.js';
import type { ITokenResolver } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

/** Closure-only deps packed by the builder — never exported. */
interface IBuilderDeps<TCreds> {
  readonly strategy: ITokenStrategy<TCreds>;
  readonly bus: IApiMediator;
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
 * Prime ladder — stored-first, fresh-fallback when a warm state
 * was supplied. Preserves rev11 belt-and-suspenders semantic
 * (spec.txt §A.3: "Stored path failure + warm state → ONE
 * retry via primeFresh").
 * @param deps - Closure deps bag.
 * @returns Header-value procedure.
 */
async function runInitial<TCreds>(deps: IBuilderDeps<TCreds>): Promise<Procedure<string>> {
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
  return { name: args.strategy.name, ...bindResolverPair(deps) };
}

export default buildResolverFromStrategy;
export { buildResolverFromStrategy };
export type { IBuildResolverArgs };
