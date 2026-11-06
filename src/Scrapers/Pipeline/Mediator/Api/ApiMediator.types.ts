/**
 * Public + internal types for the ApiMediator cluster.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IFetchStrategy, PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { IApiQueryOpts } from '../../Types/Domain/ApiQueryOpts.js';
import type { IMediatorAuthPolicy } from '../../Types/Domain/MediatorAuthPolicy.js';
import type { ITokenBus } from '../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../Types/Domain/TokenContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { ITokenResolver } from './ITokenResolver.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

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

/** Bus-level session-context snapshot. */
type SessionContext = Readonly<Record<string, unknown>>;

/**
 * Hook invoked after a successful cold session recovery.
 *
 * <p>`wasWarm` is the session's warmth *before* recovery flipped it cold.
 * Recovery clears the flag first (recover-once), so a hook that queried the
 * bus instead would always read `false` and could never tell a degraded warm
 * session apart from one that was cold all along.
 */
type RecoveredHook = (header: string, wasWarm: boolean) => Promise<void>;

/** Session warmth, policy and recovery — built by `buildRecoveryMethods`. */
interface IRecoveryMethods {
  setSessionWarm: (value: boolean) => boolean;
  wasSessionWarm: () => boolean;
  /** Whether a rejected session re-runs the whole scrape (N33). */
  recoversWholeScrape: () => boolean;
  recoverSession: () => Promise<Procedure<string>>;
  withRecoveryHook?: (hook: RecoveredHook) => boolean;
  setAuthPolicy: (policy: IMediatorAuthPolicy) => boolean;
}

/** Public ApiMediator surface — the only API phases/handlers see. */
interface IApiMediator extends Pick<ITokenBus, 'cookies' | 'clientCert'>, IRecoveryMethods {
  setBearer: (token: string) => boolean;
  setRawAuth: (headerValue: string) => boolean;
  setSessionContext: (ctx: SessionContext) => boolean;
  getSessionContext: () => SessionContext;
  withTokenResolver: (r: ITokenResolver) => WasResolverSet;
  withTokenStrategy: <TCreds>(
    strategy: ITokenStrategy<TCreds>,
    ctx: ITokenContext,
    creds: TCreds,
  ) => WasResolverSet;
  primeSession: () => Promise<Procedure<string>>;
  apiPost: <T>(
    wkUrl: WKUrlOrLiteral,
    body: PostData,
    opts?: IApiQueryOpts,
  ) => Promise<Procedure<T>>;
  apiGet: <T>(wkUrl: WKUrlOrLiteral, opts?: IApiQueryOpts) => Promise<Procedure<T>>;
  apiQuery: <T>(
    wkQuery: WKQueryOperation,
    variables: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ) => Promise<Procedure<T>>;
  readonly dispose?: () => Promise<void>;
  /**
   * The transport runs inside a browser engine, so phase transitions keep
   * the browser page-settle windows. Absent for native and node:https
   * transports, whatever cleanup hooks they carry.
   */
  readonly drivesBrowser?: true;
}

/** Bundle of collaborators captured by the closure. */
interface IApiMediatorDeps {
  readonly bankHint: CompanyTypes;
  readonly fetchStrategy: IFetchStrategy;
  readonly graphqlStrategy: GraphQLFetchStrategy;
}

/** Args for firePost — bundled to satisfy the 3-parameter ceiling. */
interface IFirePostArgs extends Pick<IApiQueryOpts, 'onSetCookie' | 'policy' | 'redactUrlValues'> {
  readonly deps: IApiMediatorDeps;
  readonly url: string;
  readonly body: PostData;
  readonly rawAuth: string;
  readonly extraHeaders: Record<string, string>;
  readonly query: Record<string, string>;
}

/** Args for fireGet — the firePost bundle minus the body (GET sends none). */
type IFireGetArgs = Omit<IFirePostArgs, 'body'>;

/** Args for fireQuery — bundled to satisfy the 3-parameter ceiling. */
interface IFireQueryArgs extends Pick<IApiQueryOpts, 'policy'> {
  readonly deps: IApiMediatorDeps;
  readonly queryString: string;
  readonly variables: Record<string, unknown>;
  readonly rawAuth: string;
  readonly extraHeaders: Record<string, string>;
}

/** Mutable mediator state isolated from the public interface. */
interface IMediatorState {
  rawAuth: string;
  resolver: ITokenResolver;
  sessionContext: SessionContext;
  sessionWarm: boolean;
  onRecovered?: RecoveredHook;
  /** True while a token re-mint is in flight — blocks refresh re-entrancy. */
  isRefreshing: boolean;
  /** False when an auth rejection must fail at once (cookie sessions). */
  rearmOnReject: boolean;
  /** False when the session is a cookie, so a re-mint yields no header. */
  installHeader: boolean;
  /** True when a rejected session re-runs the whole scrape. */
  wholeScrapeRecovery: boolean;
}

/** Per-call context shared by apiPost/apiGet/apiQuery operations. */
interface IApiCallContext {
  readonly state: IMediatorState;
  readonly deps: IApiMediatorDeps;
  readonly bankHint: CompanyTypes;
}

/** Arg bundle for `withTokenStrategyOp`. */
interface IWithTokenStrategyOpArgs<TCreds> {
  readonly state: IMediatorState;
  readonly self: IApiMediator;
  readonly strategy: ITokenStrategy<TCreds>;
  readonly ctx: ITokenContext;
  readonly creds: TCreds;
}

/** Arg bundle for `apiPostOp`. */
interface IApiPostOpArgs {
  readonly ctx: IApiCallContext;
  readonly wkUrl: WKUrlOrLiteral;
  readonly body: PostData;
  readonly opts?: IApiQueryOpts;
}

/** Arg bundle for `apiQueryOp`. */
interface IApiQueryOpArgs {
  readonly ctx: IApiCallContext;
  readonly wkQuery: WKQueryOperation;
  readonly variables: Record<string, unknown>;
  readonly opts?: IApiQueryOpts;
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

/** Args bundle for the headless-mediator factory — re-exported from {@link IHeadlessMediatorArgs}. */
// (definitions live in ./ApiMediator.headless.types.ts to keep this file ≤150 LoC)
export type { IApiQueryOpts } from '../../Types/Domain/ApiQueryOpts.js';
export type {
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IGraphQLTransportArgs,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
} from './ApiMediator.headless.types.js';

export type {
  IApiCallContext,
  IApiMediator,
  IApiMediatorDeps,
  IApiPostOpArgs,
  IApiQueryOpArgs,
  IAuthMethods,
  ICallMethods,
  IFireGetArgs,
  IFirePostArgs,
  IFireQueryArgs,
  IGraphQLEnvelope,
  IGraphQLError,
  IMediatorState,
  IRecoveryMethods,
  IResolverMethods,
  IWithTokenStrategyOpArgs,
  RecoveredHook,
  SessionContext,
  WasResolverSet,
};
