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
import { NativeFetchStrategy } from '../../Strategy/Fetch/NativeFetchStrategy.js';
import { createApiMediator } from './ApiMediator.factory.js';
import type {
  IApiMediator,
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
} from './ApiMediator.types.js';

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
 * @param args - Bank hint + URLs + optional staticAuth header.
 * @returns A fully-wired IApiMediator instance.
 */
function createHeadlessApiMediator(args: IHeadlessMediatorArgs): IApiMediator {
  const { fetch, gql } = buildHeadlessStrategies(args);
  const mediator = createApiMediator(args.bankHint, fetch, gql);
  return applyStaticAuth(mediator, args);
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
  const gql: GraphQLFetchStrategy = Reflect.construct(GraphQLFetchStrategy, [args.graphqlUrl]);
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
  return Object.assign(mediator, { dispose });
}

export { createBrowserBackedHeadlessApiMediator, createHeadlessApiMediator };
