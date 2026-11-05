/**
 * Headless-wiring shapes — the decoded transport flags and the resolved
 * wiring entry shared by the transport rule table and the mediator wiring.
 * Split from HeadlessMediatorWiring to keep that file under the 150-LoC cap.
 */

import type { IHeadlessUrlsConfig } from '../Registry/Config/PipelineBankConfigTypes.js';

/** Identity-transport flags decoded from the optional headless config block. */
interface IWiringFlags {
  readonly requiresBrowserTls: boolean;
  /** When true, present the bank's registered client certificate over node:https. */
  readonly requiresClientCert: boolean;
  /** When true, the Camoufox strategy route-intercepts the initial origin nav. */
  readonly bypassOriginChallenge: boolean;
  /** When true, identity REST runs over Node's own fetch (no browser, stock TLS). */
  readonly nativeFetch: boolean;
  /** When true, a node transport keeps one run-scoped cookie jar. */
  readonly sessionCookies: boolean;
  /** When true, native HTTP failures omit the bank's response text. */
  readonly isBankTextOmitted: boolean;
}

/** Identity transport a headless bank runs over. */
type HeadlessTransportKind = 'node-tls' | 'native' | 'browser';

/** Optional transport settings a headless config block hands to the factory. */
type TTransportKey =
  'tlsProfile' | 'clientCert' | 'cookieDomains' | 'redirectPolicy' | 'statusPolicy';

/** Pair of URLs + flags needed to wire the headless ApiMediator. */
interface IHeadlessWiring extends IWiringFlags {
  /**
   * Optional transport settings, handed to the factory untouched: the
   * node:https ClientHello profile (absent keeps Node's default), the
   * domain-jar allow-list (absent keeps the origin jar), the native
   * transport's default redirect policy (absent keeps `follow`) and its
   * status policy (absent decides no status).
   */
  readonly transport: Pick<IHeadlessUrlsConfig, TTransportKey>;
  readonly identity: string;
  readonly graphql: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
}

export type { HeadlessTransportKind, IHeadlessWiring, IWiringFlags };
