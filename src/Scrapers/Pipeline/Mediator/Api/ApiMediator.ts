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
import { CamoufoxIdentityFetchStrategy } from '../../Strategy/Fetch/CamoufoxIdentityFetchStrategy.js';
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

/** Return value of withTokenResolver — signals the registration completed. */
type WasResolverSet = true;

/** GraphQL error entry with optional message. */
interface IGraphQLError {
  readonly message?: string;
}

/** Wrapped GraphQL response: data + errors. */
interface IGraphQLEnvelope<T> {
  readonly data?: T;
  readonly errors?: readonly IGraphQLError[];
}

/** Per-call options — extraHeaders + optional URL query params + optional Set-Cookie hook. */
export interface IApiQueryOpts {
  readonly extraHeaders?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
}

/**
 * Bus-level session-context snapshot — populated by the login action
 * (`ApiDirectCallActions.runApiDirectCallAction`) from the SmsOtpFlow's
 * final carry, read by the scrape phase to resolve `$ref: carry.<slot>`
 * tokens in scrape-step body templates without re-running the login flow.
 *
 * Stays JsonValue-shaped so the same JSON pointer + ref-resolver
 * machinery the login flow uses works against it verbatim.
 */
export type SessionContext = Readonly<Record<string, unknown>>;

/** Public ApiMediator surface — the only API phases/handlers see. */
export interface IApiMediator {
  setBearer: (token: string) => boolean;
  setRawAuth: (headerValue: string) => boolean;
  /**
   * Install a frozen snapshot of the post-login carry on the bus.
   * The login action calls this once after `primeSession` succeeds;
   * the scrape phase reads via {@link getSessionContext} when
   * hydrating class-y body envelopes.
   */
  setSessionContext: (ctx: SessionContext) => boolean;
  /**
   * Return the frozen post-login carry snapshot. Empty object before
   * the login action has populated it.
   */
  getSessionContext: () => SessionContext;
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
  /**
   * Optional cleanup hook for mediators that own resources (e.g. a Camoufox
   * browser). Idempotent. Called by PipelineExecutor at scrape finalize
   * regardless of success/failure. Undefined for mediators with no owned
   * resources (e.g. NativeFetchStrategy-backed banks).
   */
  readonly dispose?: () => Promise<void>;
}

/** Empty header map — shared singleton for callers with no extras. */
const NO_EXTRA_HEADERS: Record<string, string> = Object.freeze({});

/**
 * Append query parameters to a URL preserving any existing querystring.
 * @param url - Resolved URL (may already carry ?k=v).
 * @param query - Additional key→value pairs to append.
 * @returns URL with merged querystring.
 */
function appendQuery(url: string, query: Record<string, string>): string {
  const keys = Object.keys(query);
  if (keys.length === 0) return url;
  const parts = keys.map((k): string => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`);
  const joined = parts.join('&');
  if (url.includes('?')) return `${url}&${joined}`;
  return `${url}?${joined}`;
}

/**
 * Build the outbound headers map with the currently stored Authorization value.
 * @param rawAuth - Full authorization header value (empty when unset).
 * @returns Header map including Authorization when rawAuth is non-empty.
 */
function buildHeaders(rawAuth: string): Record<string, string> {
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
function mergeHeaders(rawAuth: string, extra: Record<string, string>): Record<string, string> {
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
function firstErrorMessage(errors: readonly IGraphQLError[]): string {
  if (errors.length === 0) return '';
  const message = errors[0].message;
  if (typeof message === 'string' && message.length > 0) return message;
  return '<unknown>';
}

/**
 * Fail-helper for GraphQL envelopes with non-empty error list.
 * @param label - First error message label.
 * @returns Procedure failure.
 */
function envelopeErrorFail<T>(label: string): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, `graphql errors: ${label}`);
}

/**
 * Fail-helper for GraphQL envelopes whose `data` field is undefined.
 * @returns Procedure failure.
 */
function envelopeMissingDataFail<T>(): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, 'graphql response missing data');
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
  if (errorLabel.length > 0) return envelopeErrorFail<T>(errorLabel);
  if (envelope.data === undefined) return envelopeMissingDataFail<T>();
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
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly rawAuth: string;
  readonly extraHeaders: Record<string, string>;
  readonly query: Record<string, string>;
  readonly onSetCookie?: (setCookies: readonly string[]) => number;
}

/** Args for fireQuery — bundled to satisfy the 3-parameter ceiling. */
interface IFireQueryArgs {
  readonly deps: IApiMediatorDeps;
  readonly queryString: string;
  readonly variables: Record<string, unknown>;
  readonly rawAuth: string;
  readonly extraHeaders: Record<string, string>;
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
  url: string,
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

/** Mutable mediator state isolated from the public interface. */
interface IMediatorState {
  rawAuth: string;
  resolver: ITokenResolver;
  sessionContext: SessionContext;
}

/** Per-call context shared by apiPost/apiGet/apiQuery operations. */
interface IApiCallContext {
  readonly state: IMediatorState;
  readonly deps: IApiMediatorDeps;
  readonly bankHint: CompanyTypes;
}

/** Arg bundle for `withTokenStrategyOp` to respect the 4-param ceiling. */
interface IWithTokenStrategyOpArgs<TCreds> {
  readonly state: IMediatorState;
  readonly self: IApiMediator;
  readonly strategy: ITokenStrategy<TCreds>;
  readonly ctx: IPipelineContext;
  readonly creds: TCreds;
}

/** Arg bundle for `apiPostOp`. */
interface IApiPostOpArgs {
  readonly ctx: IApiCallContext;
  readonly wkUrl: WKUrlGroup;
  readonly body: Record<string, unknown>;
  readonly opts?: IApiQueryOpts;
}

/** Arg bundle for `apiQueryOp`. */
interface IApiQueryOpArgs {
  readonly ctx: IApiCallContext;
  readonly wkQuery: WKQueryOperation;
  readonly variables: Record<string, unknown>;
  readonly opts?: IApiQueryOpts;
}

/**
 * Construct the initial frozen-snapshot state for a fresh mediator.
 * @returns Initial state record.
 */
function makeInitialMediatorState(): IMediatorState {
  return {
    rawAuth: '',
    resolver: NULL_RESOLVER,
    sessionContext: Object.freeze({}),
  };
}

/**
 * Store an Authorization header verbatim on the mediator state.
 * @param state - Mediator state.
 * @param headerValue - Full Authorization header value.
 * @returns True once stored.
 */
function setRawAuthOp(state: IMediatorState, headerValue: string): boolean {
  state.rawAuth = headerValue;
  return true;
}

/**
 * Install the post-login session-context snapshot (freezes a copy).
 * @param state - Mediator state.
 * @param ctx - Session-context snapshot.
 * @returns True once stored.
 */
function setSessionContextOp(state: IMediatorState, ctx: SessionContext): boolean {
  state.sessionContext = Object.freeze({ ...ctx });
  return true;
}

/**
 * Return the stored session-context snapshot (frozen).
 * @param state - Mediator state.
 * @returns Session-context snapshot.
 */
function getSessionContextOp(state: IMediatorState): SessionContext {
  return state.sessionContext;
}

/**
 * Convenience wrapper — stores a `Bearer <token>` Authorization header.
 * @param state - Mediator state.
 * @param token - Opaque bearer value.
 * @returns True once stored.
 */
function setBearerOp(state: IMediatorState, token: string): boolean {
  return setRawAuthOp(state, `Bearer ${token}`);
}

/**
 * Register a concrete token resolver. Replaces any prior resolver.
 * @param state - Mediator state.
 * @param resolver - Bank-specific resolver.
 * @returns True once registered.
 */
function withTokenResolverOp(state: IMediatorState, resolver: ITokenResolver): WasResolverSet {
  state.resolver = resolver;
  return true;
}

/**
 * Register a bank token strategy bound via `buildResolverFromStrategy`.
 * @param args - Strategy + context + creds bundle.
 * @returns True once registered.
 */
function withTokenStrategyOp<TCreds>(args: IWithTokenStrategyOpArgs<TCreds>): WasResolverSet {
  const { state, self, strategy, ctx, creds } = args;
  state.resolver = buildResolverFromStrategy({ strategy, bus: self, ctx, creds });
  return true;
}

/**
 * Prime the session via the currently registered resolver.
 * @param state - Mediator state.
 * @returns Header-value procedure.
 */
async function primeSessionOp(state: IMediatorState): Promise<Procedure<string>> {
  return state.resolver.resolve();
}

/**
 * Invoke the resolver's `refresh()` with an exception safety net.
 * @param state - Mediator state.
 * @returns Refresh procedure (or a Generic failure when the resolver threw).
 */
async function safeRefreshOp(state: IMediatorState): Promise<Procedure<string>> {
  try {
    return await state.resolver.refresh();
  } catch (error) {
    const message = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `token resolver threw: ${message}`);
  }
}

/**
 * Run a request once, and on a 401 response refresh and retry once.
 * @param state - Mediator state.
 * @param fire - Function that performs the request.
 * @returns Procedure from the first or second attempt.
 */
async function retryOn401Op<T>(
  state: IMediatorState,
  fire: () => Promise<Procedure<T>>,
): Promise<Procedure<T>> {
  const first = await fire();
  if (first.success) return first;
  if (!/\s401:\s/.test(first.errorMessage)) return first;
  const refreshed = await safeRefreshOp(state);
  if (!isOk(refreshed)) return first;
  if (refreshed.value.length === 0) return first;
  setRawAuthOp(state, refreshed.value);
  return fire();
}

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
  return async () => {
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
  const fireOnce = makeApiPostFireOnce<T>(args, urlProc.value);
  return retryOn401Op(args.ctx.state, fireOnce);
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
  return async () => fireGet<T>(ctx.deps, urlValue, ctx.state.rawAuth);
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
  const fireOnce = makeApiGetFireOnce<T>(ctx, urlProc.value);
  return retryOn401Op(ctx.state, fireOnce);
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
  return async () => {
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
  const fireOnce = makeApiQueryFireOnce<T>(args, queryProc.value);
  return retryOn401Op(args.ctx.state, fireOnce);
}

/** Picked subset of `IApiMediator` produced by `buildAuthMethods`. */
type IAuthMethods = Pick<
  IApiMediator,
  'setRawAuth' | 'setBearer' | 'setSessionContext' | 'getSessionContext'
>;

/** Picked subset of `IApiMediator` produced by `buildResolverMethods`. */
type IResolverMethods = Pick<
  IApiMediator,
  'withTokenResolver' | 'withTokenStrategy' | 'primeSession'
>;

/** Picked subset of `IApiMediator` produced by `buildCallMethods`. */
type ICallMethods = Pick<IApiMediator, 'apiPost' | 'apiGet' | 'apiQuery'>;

/**
 * Build the auth/session-context method bundle.
 * @param state - Mediator state.
 * @returns Auth methods.
 */
function buildAuthMethods(state: IMediatorState): IAuthMethods {
  return {
    /**
     * Store the Authorization header verbatim.
     * @param h - Header value.
     * @returns True once stored.
     */
    setRawAuth: h => setRawAuthOp(state, h),
    /**
     * Store a `Bearer <token>` Authorization header.
     * @param t - Bearer token.
     * @returns True once stored.
     */
    setBearer: t => setBearerOp(state, t),
    /**
     * Install the post-login session-context snapshot (frozen copy).
     * @param ctx - Snapshot to install.
     * @returns True once stored.
     */
    setSessionContext: ctx => setSessionContextOp(state, ctx),
    /**
     * Read the stored session-context snapshot.
     * @returns Frozen snapshot reference.
     */
    getSessionContext: () => getSessionContextOp(state),
  };
}

/**
 * Build the resolver-registration + session-prime method bundle.
 * @param self - Mediator shell (captured by withTokenStrategy).
 * @param state - Mediator state.
 * @returns Resolver methods.
 */
function buildResolverMethods(self: IApiMediator, state: IMediatorState): IResolverMethods {
  return {
    /**
     * Register a concrete token resolver.
     * @param resolver - Bank-specific resolver.
     * @returns True once registered.
     */
    withTokenResolver: resolver => withTokenResolverOp(state, resolver),
    /**
     * Register a bank token strategy bound via `buildResolverFromStrategy`.
     * @param strategy - Bank token strategy.
     * @param ctx - Pipeline context.
     * @param creds - Bank credentials.
     * @returns True once registered.
     */
    withTokenStrategy: (strategy, ctx, creds) =>
      withTokenStrategyOp({ state, self, strategy, ctx, creds }),
    /**
     * Prime the session via the registered resolver.
     * @returns Header-value procedure.
     */
    primeSession: async () => primeSessionOp(state),
  };
}

/**
 * Build the apiPost/apiGet/apiQuery method bundle.
 * @param ctx - Per-call context.
 * @returns Call methods.
 */
function buildCallMethods(ctx: IApiCallContext): ICallMethods {
  return {
    /**
     * POST with auth-header injection and WK URL resolution.
     * @param wkUrl - WK URL group to resolve.
     * @param body - Request body.
     * @param opts - Optional per-call options.
     * @returns Procedure with typed payload.
     */
    apiPost: async (wkUrl, body, opts) => apiPostOp({ ctx, wkUrl, body, opts }),
    /**
     * GET with auth-header injection and WK URL resolution.
     * @param wkUrl - WK URL group to resolve.
     * @returns Procedure with typed payload.
     */
    apiGet: async wkUrl => apiGetOp(ctx, wkUrl),
    /**
     * GraphQL query with WK query resolution and envelope unwrap.
     * @param wkQuery - WK query operation.
     * @param variables - Query variables.
     * @param opts - Optional per-call options.
     * @returns Procedure with unwrapped GraphQL data.
     */
    apiQuery: async (wkQuery, variables, opts) => apiQueryOp({ ctx, wkQuery, variables, opts }),
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
  const self = {} as IApiMediator;
  const state: IMediatorState = makeInitialMediatorState();
  const ctx: IApiCallContext = { state, deps, bankHint };
  return assembleMediator(self, ctx);
}

/** Args bundle for the headless-mediator factory (respects 3-param ceiling). */
interface IHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly graphqlUrl: string;
  /** Optional static Authorization header installed before first call. */
  readonly staticAuth?: string;
}

/** Bundled strategy pair returned by the headless builder. */
interface IHeadlessStrategies {
  readonly fetch: NativeFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

/**
 * Construct the native + GraphQL strategies for a headless mediator.
 * @param args - Mediator args bundle.
 * @returns Strategy pair.
 */
function buildHeadlessStrategies(args: IHeadlessMediatorArgs): IHeadlessStrategies {
  const fetch: NativeFetchStrategy = Reflect.construct(NativeFetchStrategy, [args.identityBaseUrl]);
  const gql: GraphQLFetchStrategy = Reflect.construct(GraphQLFetchStrategy, [args.graphqlUrl]);
  return { fetch, gql };
}

/**
 * Build a ready-to-use ApiMediator for a headless (API-only) bank.
 * When args.staticAuth is provided, installs it via setRawAuth so the first
 * outbound call already carries the header (e.g. Transmit TSToken).
 * @param args - Bank hint + URLs + optional staticAuth header.
 * @returns A fully-wired IApiMediator instance.
 */
export function createHeadlessApiMediator(args: IHeadlessMediatorArgs): IApiMediator {
  const { fetch, gql } = buildHeadlessStrategies(args);
  const mediator = createApiMediator(args.bankHint, fetch, gql);
  if (args.staticAuth !== undefined) mediator.setRawAuth(args.staticAuth);
  return mediator;
}

/** Args bundle for the browser-backed headless-mediator factory. */
interface IBrowserBackedHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  /** Same-origin URL used for the Camoufox page navigation (e.g. 'https://identity.tfd-bank.com'). */
  readonly identityOriginUrl: string;
  readonly graphqlUrl: string;
  readonly staticAuth?: string;
  /** When true, the initial navigation to `identityOriginUrl` is route-intercepted
   * with a blank HTML stub so subsequent same-origin fetches bypass the bank's
   * Cloudflare interstitial CSP. See PipelineBankConfigTypes for details. */
  readonly bypassOriginChallenge?: boolean;
}

/** Bundled strategy pair returned by the browser-backed headless builder. */
interface IBrowserBackedStrategies {
  readonly fetch: CamoufoxIdentityFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

/**
 * Build the readonly tuple of args to Reflect.construct the Camoufox
 * identity fetch strategy with.
 * @param args - Mediator args bundle.
 * @returns Readonly tuple to pass to Reflect.construct.
 */
function buildCamoufoxConstructArgs(
  args: IBrowserBackedHeadlessMediatorArgs,
): readonly [string, boolean] {
  return [args.identityOriginUrl, args.bypassOriginChallenge === true];
}

/**
 * Construct the Camoufox + GraphQL strategies for a browser-backed
 * headless mediator.
 * @param args - Mediator args bundle.
 * @returns Strategy pair.
 */
function buildBrowserBackedStrategies(
  args: IBrowserBackedHeadlessMediatorArgs,
): IBrowserBackedStrategies {
  const camoufoxArgs = buildCamoufoxConstructArgs(args);
  const fetch: CamoufoxIdentityFetchStrategy = Reflect.construct(
    CamoufoxIdentityFetchStrategy,
    camoufoxArgs,
  );
  const gql: GraphQLFetchStrategy = Reflect.construct(GraphQLFetchStrategy, [args.graphqlUrl]);
  return { fetch, gql };
}

/**
 * Build a dispose hook bound to the underlying Camoufox strategy.
 * @param strategy - Camoufox strategy instance.
 * @returns Dispose function.
 */
function makeCamoufoxDispose(strategy: CamoufoxIdentityFetchStrategy): () => Promise<void> {
  return () => strategy.dispose();
}

/**
 * Builds an ApiMediator whose identity REST transport runs through a Camoufox
 * browser session (TLS-bypass) while GraphQL keeps the native transport.
 * The mediator exposes a dispose() hook that closes the Camoufox process.
 * @param args - Bank hint + identity base URL + same-origin nav URL + graphql URL + optional staticAuth.
 * @returns IApiMediator with dispose() plumbed through to the Camoufox strategy.
 */
export function createBrowserBackedHeadlessApiMediator(
  args: IBrowserBackedHeadlessMediatorArgs,
): IApiMediator {
  const { fetch, gql } = buildBrowserBackedStrategies(args);
  const mediator = createApiMediator(args.bankHint, fetch, gql);
  if (args.staticAuth !== undefined) mediator.setRawAuth(args.staticAuth);
  const dispose = makeCamoufoxDispose(fetch);
  return Object.assign(mediator, { dispose });
}

export type { IBrowserBackedHeadlessMediatorArgs };
