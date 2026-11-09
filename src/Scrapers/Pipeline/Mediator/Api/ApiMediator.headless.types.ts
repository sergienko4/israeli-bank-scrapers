/**
 * Headless-mediator factory types — args bundles + strategy pairs for the
 * native and node:https headless ApiMediator factories. Extracted from
 * `ApiMediator.types.ts` to keep that file under the strict 150-LoC cap.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { NativeFetchStrategy } from '../../Strategy/Fetch/NativeFetchStrategy.js';
import type { TlsClientProfileKind } from '../../Strategy/Fetch/Tls/TlsClientProfiles.js';
import type { IDynamicClientCert } from '../../Types/Domain/ClientCertControl.js';
import type {
  IResponseIntegrity,
  MediaTypePolicy,
  RedirectPolicy,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';

/** Args bundle for the headless-mediator factory. */
interface IHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly graphqlUrl: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
  /** Keep one run-scoped cookie jar on the identity transport. */
  readonly sessionCookies?: boolean;
  /** Registrable domains whose `Domain` cookies the jar keeps (RFC 6265 jar). */
  readonly cookieDomains?: readonly string[];
  /** Redirect policy for calls that name none; `follow` when absent. */
  readonly redirectPolicy?: RedirectPolicy;
  /** 2xx statuses the bank decides itself; none when absent. */
  readonly statusPolicy?: StatusPolicy;
  /** Omit bank response text from native HTTP failures when enabled. */
  readonly omitBankText?: boolean;
  /** Media type each response kind must name when a call names none. */
  readonly mediaTypes?: MediaTypePolicy;
  /** Decode every answer as strict UTF-8 unless its call says otherwise. */
  readonly strictUtf8?: boolean;
  /** Limits and optionally pins each response when the call names no policy. */
  readonly responseIntegrity?: IResponseIntegrity;
  /** Disable automatic retries after native connect timeouts. */
  readonly isConnectRetryDisabled?: boolean;
}

/** Args bundle for the node:https (client-cert and/or TLS-profile) mediator factory. */
interface INodeTlsMediatorArgs extends IHeadlessMediatorArgs {
  /** Present the bank's registered client certificate on every handshake. */
  readonly requiresClientCert?: boolean;
  /** A device certificate the flow installs at runtime, presented to one origin. */
  readonly clientCert?: IDynamicClientCert;
  /** ClientHello profile both transports present; absent keeps Node's default. */
  readonly tlsProfile?: TlsClientProfileKind;
}

/** Bundled strategy pair returned by the headless builder. */
interface IHeadlessStrategies {
  readonly fetch: NativeFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

/** Minimal shape needed to construct the shared GraphQL transport. */
interface IGraphQLTransportArgs extends Pick<
  IHeadlessMediatorArgs,
  | 'redirectPolicy'
  | 'statusPolicy'
  | 'omitBankText'
  | 'mediaTypes'
  | 'strictUtf8'
  | 'responseIntegrity'
  | 'isConnectRetryDisabled'
> {
  readonly graphqlUrl: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
}

export type {
  IGraphQLTransportArgs,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
  INodeTlsMediatorArgs,
};
