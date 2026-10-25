/**
 * Headless-mediator factory types — args bundles + strategy pairs for the
 * native and browser-backed headless ApiMediator factories. Extracted from
 * `ApiMediator.types.ts` to keep that file under the strict 150-LoC cap.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { CamoufoxIdentityFetchStrategy } from '../../Strategy/Fetch/CamoufoxIdentityFetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { NativeFetchStrategy } from '../../Strategy/Fetch/NativeFetchStrategy.js';
import type { TlsClientProfileKind } from '../../Strategy/Fetch/Tls/TlsClientProfiles.js';

/** Args bundle for the headless-mediator factory. */
interface IHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly graphqlUrl: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
}

/** Args bundle for the node:https (client-cert and/or TLS-profile) mediator factory. */
interface INodeTlsMediatorArgs extends IHeadlessMediatorArgs {
  /** Present the bank's registered client certificate on every handshake. */
  readonly requiresClientCert?: boolean;
  /** ClientHello profile both transports present; absent keeps Node's default. */
  readonly tlsProfile?: TlsClientProfileKind;
}

/** Bundled strategy pair returned by the headless builder. */
interface IHeadlessStrategies {
  readonly fetch: NativeFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

/** Args bundle for the browser-backed headless-mediator factory. */
interface IBrowserBackedHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly identityOriginUrl: string;
  readonly graphqlUrl: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
  readonly bypassOriginChallenge?: boolean;
}

/** Minimal shape needed to construct the shared GraphQL transport. */
interface IGraphQLTransportArgs {
  readonly graphqlUrl: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
}

/** Bundled strategy pair returned by the browser-backed headless builder. */
interface IBrowserBackedStrategies {
  readonly fetch: CamoufoxIdentityFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

export type {
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IGraphQLTransportArgs,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
  INodeTlsMediatorArgs,
};
