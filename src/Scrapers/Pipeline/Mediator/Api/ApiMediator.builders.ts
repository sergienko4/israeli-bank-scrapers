/**
 * Method bundle builders for the ApiMediator shell.
 * Each `bindXxx` helper curries the state/ctx capture; assemble* gather
 * the resulting bundles into an `IApiMediator` shell via `Object.assign`.
 *
 * The CallExpression-as-property-value pattern (e.g. `setRawAuth: bindXxx(state)`)
 * sidesteps `jsdoc/require-jsdoc` requirements that would otherwise force
 * per-property JSDoc on arrow shorthands and inflate function bodies past
 * the strict 10-line ceiling.
 */

import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { apiGetOp, apiPostOp, apiQueryOp } from './ApiMediator.ops.js';
import {
  getSessionContextOp,
  primeSessionOp,
  setBearerOp,
  setRawAuthOp,
  setSessionContextOp,
  withTokenResolverOp,
  withTokenStrategyOp,
} from './ApiMediator.state.js';
import type {
  IApiCallContext,
  IApiMediator,
  IApiQueryOpts,
  IAuthMethods,
  ICallMethods,
  IMediatorState,
  IResolverMethods,
  SessionContext,
  WasResolverSet,
} from './ApiMediator.types.js';
import type { ITokenResolver } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

/**
 * Bind the raw-auth setter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `setRawAuth` callable.
 */
function bindSetRawAuth(state: IMediatorState): IAuthMethods['setRawAuth'] {
  return (h: string): boolean => setRawAuthOp(state, h);
}

/**
 * Bind the bearer-token setter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `setBearer` callable.
 */
function bindSetBearer(state: IMediatorState): IAuthMethods['setBearer'] {
  return (t: string): boolean => setBearerOp(state, t);
}

/**
 * Bind the session-context setter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `setSessionContext` callable.
 */
function bindSetSessionContext(state: IMediatorState): IAuthMethods['setSessionContext'] {
  return (ctx: SessionContext): boolean => setSessionContextOp(state, ctx);
}

/**
 * Bind the session-context getter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `getSessionContext` callable.
 */
function bindGetSessionContext(state: IMediatorState): IAuthMethods['getSessionContext'] {
  return (): SessionContext => getSessionContextOp(state);
}

/**
 * Build the auth/session-context method bundle.
 * @param state - Mediator state.
 * @returns Auth methods.
 */
function buildAuthMethods(state: IMediatorState): IAuthMethods {
  return {
    setRawAuth: bindSetRawAuth(state),
    setBearer: bindSetBearer(state),
    setSessionContext: bindSetSessionContext(state),
    getSessionContext: bindGetSessionContext(state),
  };
}

/**
 * Bind the token-resolver registrar to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `withTokenResolver` callable.
 */
function bindWithTokenResolver(state: IMediatorState): IResolverMethods['withTokenResolver'] {
  return (r: ITokenResolver): WasResolverSet => withTokenResolverOp(state, r);
}

/**
 * Bind the token-strategy registrar to the given state + shell.
 * @param state - Mediator state.
 * @param self - Mediator shell (captured for the resolver builder).
 * @returns Bound `withTokenStrategy` callable.
 */
function bindWithTokenStrategy(
  state: IMediatorState,
  self: IApiMediator,
): IResolverMethods['withTokenStrategy'] {
  return <TCreds>(
    strategy: ITokenStrategy<TCreds>,
    ctx: IPipelineContext,
    creds: TCreds,
  ): WasResolverSet => withTokenStrategyOp({ state, self, strategy, ctx, creds });
}

/**
 * Bind the session-prime invocation to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `primeSession` callable.
 */
function bindPrimeSession(state: IMediatorState): IResolverMethods['primeSession'] {
  return async (): Promise<Procedure<string>> => primeSessionOp(state);
}

/**
 * Build the resolver-registration + session-prime method bundle.
 * @param self - Mediator shell (captured by withTokenStrategy).
 * @param state - Mediator state.
 * @returns Resolver methods.
 */
function buildResolverMethods(self: IApiMediator, state: IMediatorState): IResolverMethods {
  return {
    withTokenResolver: bindWithTokenResolver(state),
    withTokenStrategy: bindWithTokenStrategy(state, self),
    primeSession: bindPrimeSession(state),
  };
}

/**
 * Bind the apiPost invocation to the given per-call context.
 * @param ctx - Per-call context.
 * @returns Bound `apiPost` callable.
 */
function bindApiPost(ctx: IApiCallContext): ICallMethods['apiPost'] {
  return async <T>(
    wkUrl: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => apiPostOp<T>({ ctx, wkUrl, body, opts });
}

/**
 * Bind the apiGet invocation to the given per-call context.
 * @param ctx - Per-call context.
 * @returns Bound `apiGet` callable.
 */
function bindApiGet(ctx: IApiCallContext): ICallMethods['apiGet'] {
  return async <T>(wkUrl: WKUrlGroup): Promise<Procedure<T>> => apiGetOp<T>(ctx, wkUrl);
}

/**
 * Bind the apiQuery invocation to the given per-call context.
 * @param ctx - Per-call context.
 * @returns Bound `apiQuery` callable.
 */
function bindApiQuery(ctx: IApiCallContext): ICallMethods['apiQuery'] {
  return async <T>(
    wkQuery: WKQueryOperation,
    variables: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => apiQueryOp<T>({ ctx, wkQuery, variables, opts });
}

/**
 * Build the apiPost/apiGet/apiQuery method bundle.
 * @param ctx - Per-call context.
 * @returns Call methods.
 */
function buildCallMethods(ctx: IApiCallContext): ICallMethods {
  return {
    apiPost: bindApiPost(ctx),
    apiGet: bindApiGet(ctx),
    apiQuery: bindApiQuery(ctx),
  };
}

/**
 * Assemble all mediator methods on the provided shell.
 * @param self - Mediator shell to populate.
 * @param ctx - Per-call context.
 * @returns Same shell, populated.
 */
function assembleMediator(self: IApiMediator, ctx: IApiCallContext): IApiMediator {
  const auth = buildAuthMethods(ctx.state);
  const resolver = buildResolverMethods(self, ctx.state);
  const calls = buildCallMethods(ctx);
  return Object.assign(self, auth, resolver, calls);
}

export { assembleMediator, buildAuthMethods, buildCallMethods, buildResolverMethods };
