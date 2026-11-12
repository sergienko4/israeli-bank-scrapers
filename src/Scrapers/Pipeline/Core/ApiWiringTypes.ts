/**
 * API-wiring shapes — the decoded transport flags and the resolved wiring
 * entry shared by the transport rule table and the mediator wiring. Split
 * from ApiMediatorWiring to keep that file under the 150-LoC cap.
 */

import type { ITransportConfig } from '../Registry/Config/PipelineBankConfigTypes.js';

/** Identity-transport flags decoded from the optional transport config block. */
interface IWiringFlags {
  /** When true, present the bank's registered client certificate over node:https. */
  readonly requiresClientCert: boolean;
  /** When true, identity REST runs over Node's own fetch (stock TLS). */
  readonly nativeFetch: boolean;
  /** When true, a node transport keeps one run-scoped cookie jar. */
  readonly sessionCookies: boolean;
  /** When true, native HTTP failures omit the bank's response text. */
  readonly isBankTextOmitted: boolean;
}

/** Identity transport an API-direct bank runs over. */
type TransportKind = 'node-tls' | 'native';

/** Optional transport settings the registry config block hands to the factory. */
type TTransportKey =
  | 'tlsProfile'
  | 'clientCert'
  | 'cookieDomains'
  | 'redirectPolicy'
  | 'statusPolicy'
  | 'mediaTypes'
  | 'responseIntegrity'
  | 'isConnectRetryDisabled'
  | 'strictUtf8';

/** Pair of URLs + flags needed to wire the ApiMediator. */
interface IApiWiring extends IWiringFlags {
  /**
   * Optional transport settings, handed to the factory untouched: the
   * node:https ClientHello profile (absent keeps Node's default), the
   * domain-jar allow-list (absent keeps the origin jar), the native
   * transport's default redirect policy (absent keeps `follow`), its
   * status policy (absent decides no status), its media type defaults and
   * its strict UTF-8 choice (absent reads bodies as `text()` does).
   */
  readonly transport: Pick<ITransportConfig, TTransportKey>;
  readonly identity: string;
  readonly graphql: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
}

export type { IApiWiring, IWiringFlags, TransportKind };
