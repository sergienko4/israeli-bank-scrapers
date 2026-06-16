/**
 * Public + internal types for the ApiMediator cluster.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IFetchStrategy } from '../../Strategy/Fetch/FetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { IApiQueryOpts } from '../../Types/Domain/ApiQueryOpts.js';
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

/** Per-call options — extraHeaders + optional URL query params + optional Set-Cookie hook. */
// (definition lives in ../../Types/Domain/ApiQueryOpts.ts; re-exported below)

/** Bus-level session-context snapshot. */
type SessionContext = Readonly<Record<string, unknown>>;

/** Public ApiMediator surface — the only API phases/handlers see. */
interface IApiMediator {
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
  readonly dispose?: () => Promise<void>;
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
export type {
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
} from './ApiMediator.headless.types.js';

export type {
  IApiCallContext,
  IApiMediator,
  IApiMediatorDeps,
  IApiPostOpArgs,
  IApiQueryOpArgs,
  IApiQueryOpts,
  IAuthMethods,
  ICallMethods,
  IFirePostArgs,
  IFireQueryArgs,
  IGraphQLEnvelope,
  IGraphQLError,
  IMediatorState,
  IResolverMethods,
  IWithTokenStrategyOpArgs,
  SessionContext,
  WasResolverSet,
};
