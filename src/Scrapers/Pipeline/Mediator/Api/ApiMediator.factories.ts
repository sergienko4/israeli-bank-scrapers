/**
 * Higher-level factories: headless + browser-backed-headless ApiMediators.
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

import { CamoufoxIdentityFetchStrategy } from '../../Strategy/Fetch/CamoufoxIdentityFetchStrategy.js';
import { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { AgentSource } from '../../Strategy/Fetch/Mtls/MtlsAgentSource.js';
import { MtlsFetchStrategy } from '../../Strategy/Fetch/Mtls/MtlsFetchStrategy.js';
import { MtlsGraphQLFetchStrategy } from '../../Strategy/Fetch/Mtls/MtlsGraphQLFetchStrategy.js';
import {
  type ISessionTransport,
  withCookieSession,
} from '../../Strategy/Fetch/SessionCookieFetchStrategy.js';
import type { IClientCertControl } from '../../Types/Domain/ClientCertControl.js';
import { createApiMediator } from './ApiMediator.factory.js';
import type { INodeTlsMediatorArgs } from './ApiMediator.headless.types.js';
import { buildTransportSource } from './ApiMediator.nodeTransport.js';
import type {
  IApiMediator,
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IGraphQLTransportArgs,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
} from './ApiMediator.types.js';

/** Preserve the constructor tuple so Reflect selects its typed overload. */
type HeadlessConstructorArgs = ConstructorParameters<typeof HeadlessNativeFetchStrategy>;

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
 * Construct the shared GraphQL transport with the bank's optional header floor.
 * @param args - Anything carrying the GraphQL URL + optional default headers.
 * @returns GraphQL fetch strategy.
 */
function buildGqlStrategy(args: IGraphQLTransportArgs): GraphQLFetchStrategy {
  const headers = args.graphqlHeaders ?? {};
  const { redirectPolicy, statusPolicy } = args;
  const policies = { redirectPolicy, statusPolicy, omitBankText: args.omitBankText };
  return Reflect.construct(GraphQLFetchStrategy, [args.graphqlUrl, headers, policies]);
}

/**
 * Construct the capped native + GraphQL strategies for a headless mediator.
 * @param args - Mediator args bundle.
 * @returns Strategy pair.
 */
function buildHeadlessStrategies(args: IHeadlessMediatorArgs): IHeadlessStrategies {
  const { redirectPolicy, statusPolicy, mediaTypes, omitBankText, strictUtf8 } = args;
  const policies = { redirectPolicy, statusPolicy, mediaTypes, omitBankText, strictUtf8 };
  const constructArgs: HeadlessConstructorArgs = [args.identityBaseUrl, policies];
  const fetch = Reflect.construct(HeadlessNativeFetchStrategy, constructArgs);
  const gql = buildGqlStrategy(args);
  return { fetch, gql };
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
  args: IHeadlessMediatorArgs,
  strategies: IHeadlessStrategies,
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
function createHeadlessApiMediator(args: IHeadlessMediatorArgs): IApiMediator {
  const strategies = buildHeadlessStrategies(args);
  return assembleNodeMediator(args, strategies);
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
 * Construct the Camoufox identity fetch strategy.
 * @param args - Mediator args bundle.
 * @returns Camoufox fetch strategy.
 */
function buildCamoufoxFetch(
  args: IBrowserBackedHeadlessMediatorArgs,
): CamoufoxIdentityFetchStrategy {
  const camoufoxArgs = buildCamoufoxConstructArgs(args);
  return Reflect.construct(CamoufoxIdentityFetchStrategy, camoufoxArgs);
}

/**
 * Construct the Camoufox + GraphQL strategies for a browser-backed mediator.
 * @param args - Mediator args bundle.
 * @returns Strategy pair.
 */
function buildBrowserBackedStrategies(
  args: IBrowserBackedHeadlessMediatorArgs,
): IBrowserBackedStrategies {
  const fetch = buildCamoufoxFetch(args);
  const gql = buildGqlStrategy(args);
  return { fetch, gql };
}

/**
 * Build a dispose hook bound to the underlying Camoufox strategy.
 * @param strategy - Camoufox strategy instance.
 * @returns Dispose function.
 */
function makeCamoufoxDispose(strategy: CamoufoxIdentityFetchStrategy): () => Promise<void> {
  return async (): Promise<void> => strategy.dispose();
}

/**
 * Build an ApiMediator whose identity REST transport runs through Camoufox.
 * @param args - Bank hint + URLs + optional staticAuth header.
 * @returns IApiMediator with dispose() plumbed through to the Camoufox strategy.
 */
function createBrowserBackedHeadlessApiMediator(
  args: IBrowserBackedHeadlessMediatorArgs,
): IApiMediator {
  const { fetch, gql } = buildBrowserBackedStrategies(args);
  const mediator = createApiMediator(args.bankHint, fetch, gql);
  applyStaticAuth(mediator, args);
  const dispose = makeCamoufoxDispose(fetch);
  return Object.assign(mediator, { dispose, drivesBrowser: true as const });
}

/**
 * Construct the node:https native + GraphQL strategies sharing one agent source.
 * @param args - Mediator args bundle (identity + graphql URLs + headers).
 * @param source - Picks the HTTPS agent (certificate + profile) per request.
 * @returns Strategy pair whose transports run over node:https.
 */
function buildMtlsStrategies(
  args: IHeadlessMediatorArgs,
  source: AgentSource,
): IHeadlessStrategies {
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
  const transport = buildTransportSource(args);
  const strategies = buildMtlsStrategies(args, transport.source);
  const mediator = assembleNodeMediator(args, strategies);
  return attachClientCert(mediator, transport.control);
}

export {
  createBrowserBackedHeadlessApiMediator,
  createHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
};
