/**
 * High-level apiPost / apiGet / apiQuery operations.
 * Each call wraps URL/query resolution, builds fireOnce, and runs retry-on-401.
 */

import { resolveWkQuery } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import { resolveWkUrl } from '../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { retryOn401Op } from './ApiMediator.retry.js';
import { fireGet, firePost, fireQuery, NO_EXTRA_HEADERS } from './ApiMediator.transport.js';
import type {
  IApiCallContext,
  IApiPostOpArgs,
  IApiQueryOpArgs,
  IFirePostArgs,
  IFireQueryArgs,
} from './ApiMediator.types.js';

/**
 * Build the optional extras subset of firePost args.
 * @param args - apiPost op args.
 * @returns Optional extras subset.
 */
function buildFirePostExtras(
  args: IApiPostOpArgs,
): Pick<IFirePostArgs, 'extraHeaders' | 'query' | 'onSetCookie'> {
  return {
    extraHeaders: args.opts?.extraHeaders ?? NO_EXTRA_HEADERS,
    query: args.opts?.query ?? NO_EXTRA_HEADERS,
    onSetCookie: args.opts?.onSetCookie,
  };
}

/**
 * Build the per-attempt firePost args so retry-on-401 can re-read
 * `state.rawAuth` after a refresh installs a new header.
 * @param args - apiPost op args.
 * @param urlValue - Resolved URL.
 * @returns Fresh firePost args.
 */
function buildFirePostArgs(args: IApiPostOpArgs, urlValue: string): IFirePostArgs {
  const extras = buildFirePostExtras(args);
  return {
    deps: args.ctx.deps,
    url: urlValue,
    body: args.body,
    rawAuth: args.ctx.state.rawAuth,
    ...extras,
  };
}

/**
 * Build the per-attempt fireOnce for `apiPost`.
 * @param args - apiPost op args.
 * @param urlValue - Resolved URL.
 * @returns Async fire-once callable.
 */
function makeApiPostFireOnce<T>(
  args: IApiPostOpArgs,
  urlValue: string,
): () => Promise<Procedure<T>> {
  return async (): Promise<Procedure<T>> => {
    const firePostArgs = buildFirePostArgs(args, urlValue);
    return firePost<T>(firePostArgs);
  };
}

/**
 * POST with auth-header injection, WK URL resolution, optional
 * query params and extraHeaders. Retries once on a 401.
 * @param args - apiPost op args.
 * @returns Procedure with typed payload.
 */
async function apiPostOp<T>(args: IApiPostOpArgs): Promise<Procedure<T>> {
  const urlProc = resolveWkUrl(args.wkUrl, args.ctx.bankHint);
  if (!isOk(urlProc)) return urlProc;
  const fire = makeApiPostFireOnce<T>(args, urlProc.value);
  return retryOn401Op<T>({ state: args.ctx.state, fire });
}

/**
 * Build the per-attempt fireOnce for `apiGet`.
 * @param ctx - Per-call context.
 * @param urlValue - Resolved URL.
 * @returns Async fire-once callable.
 */
function makeApiGetFireOnce<T>(
  ctx: IApiCallContext,
  urlValue: string,
): () => Promise<Procedure<T>> {
  return async (): Promise<Procedure<T>> => fireGet<T>(ctx.deps, urlValue, ctx.state.rawAuth);
}

/**
 * GET with auth-header injection and WK URL resolution. Retries once on 401.
 * @param ctx - Per-call context.
 * @param wkUrl - WK URL group to resolve.
 * @returns Procedure with typed payload.
 */
async function apiGetOp<T>(ctx: IApiCallContext, wkUrl: WKUrlGroup): Promise<Procedure<T>> {
  const urlProc = resolveWkUrl(wkUrl, ctx.bankHint);
  if (!isOk(urlProc)) return urlProc;
  const fire = makeApiGetFireOnce<T>(ctx, urlProc.value);
  return retryOn401Op<T>({ state: ctx.state, fire });
}

/**
 * Build the per-attempt fireQuery args so retry-on-401 can re-read
 * `state.rawAuth` after a refresh installs a new header.
 * @param args - apiQuery op args.
 * @param queryString - Resolved GraphQL query string.
 * @returns Fresh fireQuery args.
 */
function buildFireQueryArgs(args: IApiQueryOpArgs, queryString: string): IFireQueryArgs {
  const { ctx, variables, opts } = args;
  return {
    deps: ctx.deps,
    queryString,
    variables,
    rawAuth: ctx.state.rawAuth,
    extraHeaders: opts?.extraHeaders ?? NO_EXTRA_HEADERS,
  };
}

/**
 * Build the per-attempt fireOnce for `apiQuery`.
 * @param args - apiQuery op args.
 * @param queryString - Resolved GraphQL query string.
 * @returns Async fire-once callable.
 */
function makeApiQueryFireOnce<T>(
  args: IApiQueryOpArgs,
  queryString: string,
): () => Promise<Procedure<T>> {
  return async (): Promise<Procedure<T>> => {
    const fireQueryArgs = buildFireQueryArgs(args, queryString);
    return fireQuery<T>(fireQueryArgs);
  };
}

/**
 * GraphQL query with WK query resolution + envelope unwrap. Retries once on 401.
 * @param args - apiQuery op args.
 * @returns Procedure with unwrapped GraphQL data.
 */
async function apiQueryOp<T>(args: IApiQueryOpArgs): Promise<Procedure<T>> {
  const queryProc = resolveWkQuery(args.wkQuery, args.ctx.bankHint);
  if (!isOk(queryProc)) return queryProc;
  const fire = makeApiQueryFireOnce<T>(args, queryProc.value);
  return retryOn401Op<T>({ state: args.ctx.state, fire });
}

export { apiGetOp, apiPostOp, apiQueryOp };
