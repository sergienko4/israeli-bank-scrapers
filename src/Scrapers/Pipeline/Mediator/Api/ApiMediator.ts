/**
 * ApiMediator — headless transport mediator (the Black Box).
 * Owns URL resolution, header composition, GraphQL error unwrap, Bearer storage.
 * Phases/handlers call apiPost / apiGet / apiQuery — they never see tokens or raw responses.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import { resolveWkQuery } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import { resolveWkUrl } from '../../Registry/WK/UrlsWK.js';
import type { IFetchStrategy, PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import { NativeFetchStrategy } from '../../Strategy/Fetch/NativeFetchStrategy.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { ITokenResolver } from './ITokenResolver.js';
import { NULL_RESOLVER } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';
import { buildResolverFromStrategy } from './TokenResolverBuilder.js';

/** Headers map for outbound requests. */
type HeaderMap = Record<string, string>;

/** Bearer token (opaque string). */
type BearerToken = string;

/** Resolved URL ready for transport. */
type ResolvedUrl = string;

/** URL with merged querystring parameters appended. */
type UrlWithQuery = string;

/** Encoded "k=v" query-string pair. */
type QueryStringPair = string;

/** Resolved GraphQL query string ready for transport. */
type QueryString = string;

/** First-error-message extraction result ('' when the list is empty). */
type GraphqlErrorLabel = string;

/** Return value of withTokenResolver — signals the registration completed. */
type WasResolverSet = true;

/** Return value of setBearer — signals the store completed. */
type WasBearerSet = boolean;

/** GraphQL error message text. */
type GraphqlErrorMessage = string;

/** GraphQL error entry with optional message. */
interface IGraphQLError {
  readonly message?: GraphqlErrorMessage;
}

/** Wrapped GraphQL response: data + errors. */
interface IGraphQLEnvelope<T> {
  readonly data?: T;
  readonly errors?: readonly IGraphQLError[];
}

/** Per-call options — extraHeaders + optional URL query params + optional Set-Cookie hook. */
export interface IApiQueryOpts {
  readonly extraHeaders?: HeaderMap;
  readonly query?: HeaderMap;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
}

/** Public ApiMediator surface — the only API phases/handlers see. */
export interface IApiMediator {
  setBearer: (token: BearerToken) => WasBearerSet;
  setRawAuth: (headerValue: string) => WasBearerSet;
  withTokenResolver: (r: ITokenResolver) => WasResolverSet;
  withTokenStrategy: <TCreds>(
    strategy: ITokenStrategy<TCreds>,
    ctx: IPipelineContext,
    creds: TCreds,
  ) => WasResolverSet;
  primeSession: () => Promise<Procedure<string>>;
  apiPost: <T>(
    wkUrl: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ) => Promise<Procedure<T>>;
  apiGet: <T>(wkUrl: WKUrlGroup) => Promise<Procedure<T>>;
  apiQuery: <T>(
    wkQuery: WKQueryOperation,
    variables: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ) => Promise<Procedure<T>>;
}

/** Empty header map — shared singleton for callers with no extras. */
const NO_EXTRA_HEADERS: HeaderMap = Object.freeze({});

/**
 * Append query parameters to a URL preserving any existing querystring.
 * @param url - Resolved URL (may already carry ?k=v).
 * @param query - Additional key→value pairs to append.
 * @returns URL with merged querystring.
 */
function appendQuery(url: string, query: HeaderMap): UrlWithQuery {
  const keys = Object.keys(query);
  if (keys.length === 0) return url;
  const parts = keys.map(
    (k): QueryStringPair => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`,
  );
  const joined = parts.join('&');
  if (url.includes('?')) return `${url}&${joined}`;
  return `${url}?${joined}`;
}

/**
 * Build the outbound headers map with the currently stored Authorization value.
 * @param rawAuth - Full authorization header value (empty when unset).
 * @returns Header map including Authorization when rawAuth is non-empty.
 */
function buildHeaders(rawAuth: string): HeaderMap {
  if (rawAuth === '') return {};
  return { authorization: rawAuth };
}

/**
 * Merge per-call extraHeaders with the stored Authorization header.
 * Stored auth wins on key collision so callers cannot clobber it accidentally.
 * @param rawAuth - Current auth header value (empty when unset).
 * @param extra - Per-call headers supplied by the caller.
 * @returns Combined header map.
 */
function mergeHeaders(rawAuth: string, extra: HeaderMap): HeaderMap {
  return { ...extra, ...buildHeaders(rawAuth) };
}

/**
 * Convert an arbitrary body to the transport's PostData shape.
 * The underlying transport accepts string | string[] | object values;
 * any non-function record value fits.
 * @param body - Caller-supplied body.
 * @returns Body typed for the fetch strategy.
 */
function toPostData(body: Record<string, unknown>): PostData {
  return body as PostData;
}

/**
 * Extract the first GraphQL error message, or the fallback label when absent.
 * @param errors - Error list from the envelope (empty when absent).
 * @returns Message string ('' only when errors list is empty).
 */
function firstErrorMessage(errors: readonly IGraphQLError[]): GraphqlErrorLabel {
  if (errors.length === 0) return '';
  const message = errors[0].message;
  if (typeof message === 'string' && message.length > 0) return message;
  return '<unknown>';
}

/**
 * Unwrap a GraphQL envelope to a Procedure payload.
 * Errors → fail. Missing data → fail. Success → succeed(data).
 * @param envelope - Raw GraphQL response object.
 * @returns Procedure with unwrapped data.
 */
function unwrapGraphql<T>(envelope: IGraphQLEnvelope<T>): Procedure<T> {
  const errors = envelope.errors ?? [];
  const errorLabel = firstErrorMessage(errors);
  if (errorLabel.length > 0) {
    return fail(ScraperErrorTypes.Generic, `graphql errors: ${errorLabel}`);
  }
  if (envelope.data === undefined) {
    return fail(ScraperErrorTypes.Generic, 'graphql response missing data');
  }
  return succeed(envelope.data);
}

/** Bundle of collaborators captured by the closure. */
interface IApiMediatorDeps {
  readonly bankHint: CompanyTypes;
  readonly fetchStrategy: IFetchStrategy;
  readonly graphqlStrategy: GraphQLFetchStrategy;
}

/** Args for firePost — bundled to satisfy the 3-parameter ceiling. */
interface IFirePostArgs {
  readonly deps: IApiMediatorDeps;
  readonly url: ResolvedUrl;
  readonly body: Record<string, unknown>;
  readonly rawAuth: string;
  readonly extraHeaders: HeaderMap;
  readonly query: HeaderMap;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
}

/** Args for fireQuery — bundled to satisfy the 3-parameter ceiling. */
interface IFireQueryArgs {
  readonly deps: IApiMediatorDeps;
  readonly queryString: QueryString;
  readonly variables: Record<string, unknown>;
  readonly rawAuth: string;
  readonly extraHeaders: HeaderMap;
}

/**
 * Execute apiPost after URL resolution has succeeded.
 * @param args - Bundled firePost arguments.
 * @returns Typed Procedure from the transport.
 */
async function firePost<T>(args: IFirePostArgs): Promise<Procedure<T>> {
  const headers = mergeHeaders(args.rawAuth, args.extraHeaders);
  const payload = toPostData(args.body);
  const finalUrl = appendQuery(args.url, args.query);
  const fetchOpts = { extraHeaders: headers, onSetCookie: args.onSetCookie };
  return args.deps.fetchStrategy.fetchPost<T>(finalUrl, payload, fetchOpts);
}

/**
 * Execute apiGet after URL resolution has succeeded.
 * @param deps - Bundled collaborators.
 * @param url - Resolved URL.
 * @param rawAuth - Current Authorization header value.
 * @returns Typed Procedure from the transport.
 */
async function fireGet<T>(
  deps: IApiMediatorDeps,
  url: ResolvedUrl,
  rawAuth: string,
): Promise<Procedure<T>> {
  const extraHeaders = buildHeaders(rawAuth);
  return deps.fetchStrategy.fetchGet<T>(url, { extraHeaders });
}

/**
 * Execute apiQuery after query-string resolution has succeeded.
 * @param args - Bundled fireQuery arguments.
 * @returns Unwrapped Procedure with the GraphQL data payload.
 */
async function fireQuery<T>(args: IFireQueryArgs): Promise<Procedure<T>> {
  const extraHeaders = mergeHeaders(args.rawAuth, args.extraHeaders);
  const envelopeProc = await args.deps.graphqlStrategy.query<IGraphQLEnvelope<T>>(
    args.queryString,
    args.variables,
    { extraHeaders },
  );
  if (!isOk(envelopeProc)) return envelopeProc;
  return unwrapGraphql<T>(envelopeProc.value);
}

/**
 * Create an ApiMediator instance (the Black Box).
 * Bearer state lives in a closed-over variable — callers have no direct access.
 * @param bankHint - Target bank (for WK lookups).
 * @param fetchStrategy - Low-level HTTP transport (Agent 1).
 * @param graphqlStrategy - GraphQL transport (Agent 1).
 * @returns ApiMediator implementation.
 */
export function createApiMediator(
  bankHint: CompanyTypes,
  fetchStrategy: IFetchStrategy,
  graphqlStrategy: GraphQLFetchStrategy,
): IApiMediator {
  const deps: IApiMediatorDeps = { bankHint, fetchStrategy, graphqlStrategy };
  /** Mutable shell populated via Object.assign below — captured by withTokenStrategy. */
  const self = {} as IApiMediator;
  const state: { rawAuth: string; resolver: ITokenResolver } = {
    rawAuth: '',
    resolver: NULL_RESOLVER,
  };

  /**
   * Store an Authorization header verbatim (caller owns the scheme).
   * @param headerValue - Full Authorization header value.
   * @returns True once stored.
   */
  const setRawAuth = (headerValue: string): WasBearerSet => {
    state.rawAuth = headerValue;
    return true;
  };

  /**
   * Convenience wrapper — prefixes "Bearer " for JWT flows.
   * @param token - Opaque bearer value.
   * @returns True once stored.
   */
  const setBearer = (token: BearerToken): WasBearerSet => setRawAuth(`Bearer ${token}`);

  /**
   * Register a concrete token resolver. Replaces any prior resolver.
   * Kept for NULL_RESOLVER + unit tests; banks use withTokenStrategy.
   * @param resolver - Bank-specific resolver.
   * @returns True once registered.
   */
  const withTokenResolver = (resolver: ITokenResolver): WasResolverSet => {
    state.resolver = resolver;
    return true;
  };

  /**
   * Register a bank token strategy (generic, TCreds-parameterised).
   * Internally binds the strategy + context + creds into an
   * ITokenResolver via TokenResolverBuilder and registers it.
   * @param strategy - Bank token strategy.
   * @param ctx - Pipeline context.
   * @param creds - Bank credentials.
   * @returns True once registered.
   */
  const withTokenStrategy = <TCreds>(
    strategy: ITokenStrategy<TCreds>,
    ctx: IPipelineContext,
    creds: TCreds,
  ): WasResolverSet => {
    state.resolver = buildResolverFromStrategy({ strategy, bus: self, ctx, creds });
    return true;
  };

  /**
   * Prime the session via the registered resolver's ladder.
   * Runs the stored-then-fresh retry behaviour exactly once at
   * login time (spec.txt §A.1). Returns the Authorization header
   * value so callers can install it via setRawAuth.
   * @returns Header-value procedure.
   */
  const primeSession = async (): Promise<Procedure<string>> => {
    return state.resolver.resolve();
  };

  /**
   * Invoke the current resolver's refresh() with an exception safety net.
   * @returns Refresh procedure (or a Generic failure when the resolver threw).
   */
  const safeRefresh = async (): Promise<Procedure<string>> => {
    try {
      return await state.resolver.refresh();
    } catch (err) {
      const message = toErrorMessage(err as Error);
      return fail(ScraperErrorTypes.Generic, `token resolver threw: ${message}`);
    }
  };

  /**
   * Run a request once, and on a 401 response refresh the Authorization
   * header via the resolver and retry exactly once. Any other outcome
   * propagates verbatim. 401 detection reads the NativeFetchStrategy
   * error-message format (`"<VERB> <URL> 401: <body>"`) — no dedicated
   * Unauthorized error type exists.
   * @param fire - Function that performs the request.
   * @returns Procedure from the first or second attempt.
   */
  const retryOn401 = async <T>(fire: () => Promise<Procedure<T>>): Promise<Procedure<T>> => {
    const first = await fire();
    if (first.success) return first;
    if (!/\s401:\s/.test(first.errorMessage)) return first;
    const refreshed = await safeRefresh();
    if (!isOk(refreshed)) return first;
    if (refreshed.value.length === 0) return first;
    setRawAuth(refreshed.value);
    return fire();
  };

  /**
   * POST with auth-header injection, WK URL resolution, optional
   * query params and extraHeaders. Retries once on a 401.
   * @param wkUrl - WK URL group to resolve.
   * @param body - Request body.
   * @param opts - Optional per-call options (query + extraHeaders).
   * @returns Procedure with typed payload.
   */
  const apiPost = async <T>(
    wkUrl: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => {
    const urlProc = resolveWkUrl(wkUrl, bankHint);
    if (!isOk(urlProc)) return urlProc;
    /**
     * Build the per-attempt firePost args so retry-on-401 can re-read
     * state.rawAuth after a refresh installs a new header.
     * @returns Fresh firePost args.
     */
    const buildArgs = (): IFirePostArgs => ({
      deps,
      url: urlProc.value,
      body,
      rawAuth: state.rawAuth,
      extraHeaders: opts?.extraHeaders ?? NO_EXTRA_HEADERS,
      query: opts?.query ?? NO_EXTRA_HEADERS,
      onSetCookie: opts?.onSetCookie,
    });
    /**
     * One attempt — re-reads args so the second call sees a refreshed token.
     * @returns Post procedure.
     */
    const fireOnce = async (): Promise<Procedure<T>> => {
      const args = buildArgs();
      return firePost<T>(args);
    };
    return retryOn401(fireOnce);
  };

  /**
   * GET with auth-header injection and WK URL resolution. Retries once on 401.
   * @param wkUrl - WK URL group to resolve.
   * @returns Procedure with typed payload.
   */
  const apiGet = async <T>(wkUrl: WKUrlGroup): Promise<Procedure<T>> => {
    const urlProc = resolveWkUrl(wkUrl, bankHint);
    if (!isOk(urlProc)) return urlProc;
    return retryOn401(async () => fireGet<T>(deps, urlProc.value, state.rawAuth));
  };

  /**
   * GraphQL query with WK query resolution, optional extra headers, and
   * envelope unwrap. Retries once on a 401.
   * @param wkQuery - WK query operation.
   * @param variables - Query variables.
   * @param opts - Optional per-call options (e.g. extraHeaders).
   * @returns Procedure with unwrapped GraphQL data.
   */
  const apiQuery = async <T>(
    wkQuery: WKQueryOperation,
    variables: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => {
    const queryProc = resolveWkQuery(wkQuery, bankHint);
    if (!isOk(queryProc)) return queryProc;
    /**
     * Build the per-attempt fireQuery args so retry-on-401 can re-read
     * state.rawAuth after a refresh installs a new header.
     * @returns Fresh fireQuery args.
     */
    const buildArgs = (): IFireQueryArgs => ({
      deps,
      queryString: queryProc.value,
      variables,
      rawAuth: state.rawAuth,
      extraHeaders: opts?.extraHeaders ?? NO_EXTRA_HEADERS,
    });
    /**
     * One attempt — re-reads args so the second call sees a refreshed token.
     * @returns Query procedure.
     */
    const fireOnce = async (): Promise<Procedure<T>> => {
      const args = buildArgs();
      return fireQuery<T>(args);
    };
    return retryOn401(fireOnce);
  };

  Object.assign(self, {
    setBearer,
    setRawAuth,
    withTokenResolver,
    withTokenStrategy,
    primeSession,
    apiPost,
    apiGet,
    apiQuery,
  });
  return self;
}

/** Args bundle for the headless-mediator factory (respects 3-param ceiling). */
interface IHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: ResolvedUrl;
  readonly graphqlUrl: ResolvedUrl;
  /** Optional static Authorization header installed before first call. */
  readonly staticAuth?: string;
}

/**
 * Build a ready-to-use ApiMediator for a headless (API-only) bank.
 * When args.staticAuth is provided, installs it via setRawAuth so the first
 * outbound call already carries the header (e.g. Transmit TSToken).
 * @param args - Bank hint + URLs + optional staticAuth header.
 * @returns A fully-wired IApiMediator instance.
 */
export function createHeadlessApiMediator(args: IHeadlessMediatorArgs): IApiMediator {
  const fetchStrategy: NativeFetchStrategy = Reflect.construct(NativeFetchStrategy, [
    args.identityBaseUrl,
  ]);
  const graphqlStrategy: GraphQLFetchStrategy = Reflect.construct(GraphQLFetchStrategy, [
    args.graphqlUrl,
  ]);
  const mediator = createApiMediator(args.bankHint, fetchStrategy, graphqlStrategy);
  if (args.staticAuth) mediator.setRawAuth(args.staticAuth);
  return mediator;
}
