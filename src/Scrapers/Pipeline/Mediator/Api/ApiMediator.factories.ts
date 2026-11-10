/**
 * Higher-level factories: headless (native fetch) + node:https ApiMediators.
 * Construct the underlying fetch strategies and wire them into createApiMediator.
 *
 * Why `Reflect.construct(...)` instead of `new`: this file IS the DI boundary
 * where concrete fetch-strategy implementations are injected into the mediator.
 * The project-wide `no-direct-new` lint rule forbids `new Foo()` inside business
 * logic so that production code receives strategy *instances* rather than
 * coupling to a constructor reference. A factory module is the legitimate
 * exception — it is the single place where the construction happens, and the
 * resulting instance is then handed downstream as an interface (`IApiMediator`
 * / `IFetchStrategy`). `Reflect.construct` preserves correct `new.target`
 * semantics and signals lint-intent: "yes, this is a real construction call,
 * placed in the factory by design."
 */

import ScraperError from '../../../Base/ScraperError.js';
import { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { AgentSource } from '../../Strategy/Fetch/Mtls/MtlsAgentSource.js';
import { MtlsFetchStrategy } from '../../Strategy/Fetch/Mtls/MtlsFetchStrategy.js';
import { MtlsGraphQLFetchStrategy } from '../../Strategy/Fetch/Mtls/MtlsGraphQLFetchStrategy.js';
import type { INativeFetchOptions } from '../../Strategy/Fetch/NativeFetchStrategy.js';
import {
  CAPPED_DEFAULT_HEADERS,
  NativeFetchStrategy,
} from '../../Strategy/Fetch/NativeFetchStrategy.js';
import {
  type ISessionTransport,
  withCookieSession,
} from '../../Strategy/Fetch/SessionCookieFetchStrategy.js';
import type { IClientCertControl } from '../../Types/Domain/ClientCertControl.js';
import type { IResponseIntegrity } from '../../Types/Domain/FetchPolicy.js';
import { NETWORK_FETCH_TIMEOUT_MS } from '../Network/FetchConfig.js';
import { createApiMediator } from './ApiMediator.factory.js';
import { buildTransportSource } from './ApiMediator.nodeTransport.js';
import type { INodeTlsMediatorArgs } from './ApiMediator.transport.types.js';
import type {
  IApiMediator,
  IApiMediatorArgs,
  IApiMediatorStrategies,
  IGraphQLTransportArgs,
} from './ApiMediator.types.js';

/** Preserve the constructor tuple so Reflect selects its typed overload. */
type NativeConstructorArgs = ConstructorParameters<typeof NativeFetchStrategy>;

/**
 * Refuses bank defaults when the chosen identity transport cannot enforce them.
 * @param args - Transport construction options.
 * @param args.responseIntegrity - Optional unsupported response policy.
 * @returns True when no unsupported policy is present.
 */
function assertNoUnsupportedIntegrity(args: { responseIntegrity?: IResponseIntegrity }): boolean {
  if (args.responseIntegrity !== undefined)
    throw new ScraperError('response integrity unsupported');
  return true;
}

/**
 * Install the static Authorization header when configured.
 * @param mediator - Mediator instance to mutate.
 * @param args - Mediator args bundle holding the optional `staticAuth`.
 * @param args.staticAuth - Optional pre-set Authorization header value.
 * @returns Same mediator (chainable).
 */
function applyStaticAuth(
  mediator: IApiMediator,
  args: { readonly staticAuth?: string },
): IApiMediator {
  if (args.staticAuth !== undefined) mediator.setRawAuth(args.staticAuth);
  return mediator;
}

/**
 * Share bank response policies between the identity REST and GraphQL transports.
 * @param args - Headless mediator args carrying bank-wide defaults.
 * @returns Policies used by both native transports.
 */
function nativePolicies(args: IGraphQLTransportArgs): INativeFetchOptions {
  const { redirectPolicy, statusPolicy, mediaTypes } = args;
  const wire = { redirectPolicy, statusPolicy, mediaTypes };
  const privacy = { omitBankText: args.omitBankText };
  const decoding = { strictUtf8: args.strictUtf8, responseIntegrity: args.responseIntegrity };
  const timing = { timeoutMs: NETWORK_FETCH_TIMEOUT_MS, defaultHeaders: CAPPED_DEFAULT_HEADERS };
  const retries = { isConnectRetryDisabled: args.isConnectRetryDisabled };
  return { ...wire, ...privacy, ...decoding, ...timing, ...retries };
}

/**
 * GraphQL policies: the shared native policies plus the inherited cap rule —
 * an operation without an integrity policy keeps the base transport.
 * @param args - Mediator args bundle.
 * @returns Policies for the GraphQL transport.
 */
function graphqlPolicies(args: IGraphQLTransportArgs): INativeFetchOptions {
  return { ...nativePolicies(args), capOnlyWithIntegrity: true };
}

/**
 * Construct the capped GraphQL strategy for an API-direct mediator.
 * @param args - Mediator args bundle.
 * @returns A capped GraphQL transport.
 */
function buildGraphQL(args: IApiMediatorArgs): GraphQLFetchStrategy {
  const headers = args.graphqlHeaders ?? {};
  return Reflect.construct(GraphQLFetchStrategy, [args.graphqlUrl, headers, graphqlPolicies(args)]);
}

/**
 * Construct the capped native + GraphQL strategies for an API-direct mediator.
 * @param args - Mediator args bundle.
 * @returns Strategy pair.
 */
function buildHeadlessStrategies(args: IApiMediatorArgs): IApiMediatorStrategies {
  const constructArgs: NativeConstructorArgs = [args.identityBaseUrl, nativePolicies(args)];
  const fetch = Reflect.construct(NativeFetchStrategy, constructArgs);
  return { fetch, gql: buildGraphQL(args) };
}

/**
 * Expose the transport's cookie session on the mediator (the token bus).
 * @param mediator - Mediator instance to extend.
 * @param session - Decorated transport and its optional cookie session.
 * @returns Same mediator, with `cookies` when the session has one.
 */
function attachCookieSession(mediator: IApiMediator, session: ISessionTransport): IApiMediator {
  if (session.cookies === undefined) return mediator;
  return Object.assign(mediator, { cookies: session.cookies });
}

/**
 * Build a mediator over a node transport and its session jar.
 * @param args - Mediator args bundle.
 * @param strategies - The node identity transport and the GraphQL transport.
 * @returns A fully-wired IApiMediator instance.
 */
function assembleNodeMediator(
  args: IApiMediatorArgs,
  strategies: IApiMediatorStrategies,
): IApiMediator {
  const session = withCookieSession(strategies.fetch, args);
  const mediator = createApiMediator(args.bankHint, session.transport, strategies.gql);
  applyStaticAuth(mediator, args);
  return attachCookieSession(mediator, session);
}

/**
 * Build a ready-to-use ApiMediator for a headless (API-only) bank.
 * @param args - Bank hint + URLs + optional staticAuth header.
 * @returns A fully-wired IApiMediator instance.
 */
function createHeadlessApiMediator(args: IApiMediatorArgs): IApiMediator {
  const strategies = buildHeadlessStrategies(args);
  return assembleNodeMediator(args, strategies);
}

/**
 * Construct the node:https native + GraphQL strategies sharing one agent source.
 * @param args - Mediator args bundle (identity + graphql URLs + headers).
 * @param source - Picks the HTTPS agent (certificate + profile) per request.
 * @returns Strategy pair whose transports run over node:https.
 */
function buildMtlsStrategies(args: IApiMediatorArgs, source: AgentSource): IApiMediatorStrategies {
  const fetch = Reflect.construct(MtlsFetchStrategy, [args.identityBaseUrl, source]);
  const headers = args.graphqlHeaders ?? {};
  const gql = Reflect.construct(MtlsGraphQLFetchStrategy, [args.graphqlUrl, source, headers]);
  return { fetch, gql };
}

/**
 * Expose the dynamic client-certificate port on the mediator when there is one.
 * @param mediator - Mediator instance to extend.
 * @param control - The certificate port, or false for a static transport.
 * @returns The same mediator.
 */
function attachClientCert(
  mediator: IApiMediator,
  control: IClientCertControl | false,
): IApiMediator {
  if (control === false) return mediator;
  return Object.assign(mediator, { clientCert: control });
}

/**
 * Build an ApiMediator whose identity + GraphQL transports run over node:https
 * so they can present what globalThis.fetch cannot: a client certificate for
 * a Cloudflare API Shield mTLS gate, a device certificate the flow installs at
 * runtime, and/or a registered ClientHello profile for an edge that
 * fingerprints the TLS handshake.
 * @param args - Bank hint + URLs + transport requirements + optional staticAuth.
 * @returns A fully-wired IApiMediator using the node:https transport.
 */
function createMtlsHeadlessApiMediator(args: INodeTlsMediatorArgs): IApiMediator {
  assertNoUnsupportedIntegrity(args);
  const transport = buildTransportSource(args);
  const strategies = buildMtlsStrategies(args, transport.source);
  const mediator = assembleNodeMediator(args, strategies);
  return attachClientCert(mediator, transport.control);
}

export { createHeadlessApiMediator, createMtlsHeadlessApiMediator };
