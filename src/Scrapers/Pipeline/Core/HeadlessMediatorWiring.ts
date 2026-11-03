/**
 * Headless-mediator wiring — resolves which ApiMediator (if any) a headless
 * descriptor needs, and which identity transport it uses. An ordered rule
 * table picks the transport: a bank that needs a client certificate and/or a
 * TLS ClientHello profile (OneZero) runs over node:https; a bank that opts in
 * with `nativeFetch` runs over Node's own fetch; every other bank (Pepper /
 * PayBox) routes identity REST through the Camoufox strategy. Extracted from
 * PipelineContextFactory to keep that file under the strict 150-LoC cap.
 */

import ScraperError from '../../Base/ScraperError.js';
import {
  createBrowserBackedHeadlessApiMediator,
  createHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
  type IApiMediator,
} from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IHeadlessUrlsConfig } from '../Registry/Config/PipelineBankConfigTypes.js';
import type { TlsClientProfileKind } from '../Strategy/Fetch/Tls/TlsClientProfiles.js';
import type { Option } from '../Types/Option.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

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
}

/** Identity transport a headless bank runs over. */
type HeadlessTransportKind = 'node-tls' | 'native' | 'browser';

/** Pair of URLs + flags needed to wire the headless ApiMediator. */
interface IHeadlessWiring extends IWiringFlags {
  readonly identity: string;
  readonly graphql: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
  /** ClientHello profile for the node:https transport; absent keeps Node's default. */
  readonly tlsProfile?: TlsClientProfileKind;
}

/** Arg bundle accepted by every headless mediator factory (superset of each). */
type TMediatorArgs = Parameters<typeof createBrowserBackedHeadlessApiMediator>[0] &
  Parameters<typeof createMtlsHeadlessApiMediator>[0];

/** Identity-transport slice of the mediator args. */
type TIdentityArgs = Pick<TMediatorArgs, 'bankHint' | 'identityBaseUrl' | 'identityOriginUrl'>;

/** GraphQL slice of the mediator args. */
type TGraphqlArgs = Pick<TMediatorArgs, 'graphqlUrl' | 'graphqlHeaders' | 'staticAuth'>;

/** Transport-requirement slice of the mediator args. */
type TTransportArgs = Pick<
  TMediatorArgs,
  'bypassOriginChallenge' | 'requiresClientCert' | 'tlsProfile' | 'sessionCookies'
>;

/**
 * Decode the optional transport flags into explicit booleans.
 * @param headless - Headless URL block from PIPELINE_BANK_CONFIG.
 * @returns The transport flags, each defaulted to false when absent.
 */
function toWiringFlags(headless: IHeadlessUrlsConfig): IWiringFlags {
  return {
    requiresBrowserTls: headless.requiresBrowserTls === true,
    requiresClientCert: headless.requiresClientCert === true,
    bypassOriginChallenge: headless.bypassOriginChallenge === true,
    nativeFetch: headless.nativeFetch === true,
    sessionCookies: headless.sessionCookies === true,
  };
}

/**
 * Map a headless config block onto the wiring shape the factories consume.
 * @param headless - Headless URL block from PIPELINE_BANK_CONFIG.
 * @returns Resolved wiring (URLs + decoded flags).
 */
function toHeadlessWiring(headless: IHeadlessUrlsConfig): IHeadlessWiring {
  const flags = toWiringFlags(headless);
  const { identityBase, graphql, graphqlHeaders, staticAuth, tlsProfile } = headless;
  return { identity: identityBase, graphql, graphqlHeaders, staticAuth, tlsProfile, ...flags };
}

/**
 * Resolve identity + graphql URLs + transport flags from PIPELINE_BANK_CONFIG.
 * Returns false when the bank is not registered or has no headless block.
 * @param companyId - Target bank company type.
 * @returns Resolved wiring, or false when the lookup fails.
 */
function resolveHeadlessWiring(companyId: IPipelineContext['companyId']): IHeadlessWiring | false {
  const config = resolvePipelineBankConfig(companyId);
  if (config === false || !config.headless) return false;
  return toHeadlessWiring(config.headless);
}

/**
 * Build the identity-transport slice of the mediator args.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns bankHint plus the identity base + origin URLs.
 */
function toIdentityArgs(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): TIdentityArgs {
  const { origin } = new URL(wiring.identity);
  return { bankHint: companyId, identityBaseUrl: wiring.identity, identityOriginUrl: origin };
}

/**
 * Build the GraphQL slice of the mediator args.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns GraphQL endpoint plus its optional headers + static auth.
 */
function toGraphqlArgs(wiring: IHeadlessWiring): TGraphqlArgs {
  const { graphql, graphqlHeaders, staticAuth } = wiring;
  return { graphqlUrl: graphql, graphqlHeaders, staticAuth };
}

/**
 * Build the transport-requirement slice of the mediator args.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Origin-challenge bypass, client-cert flag, TLS profile and cookie jar flag.
 */
function toTransportArgs(wiring: IHeadlessWiring): TTransportArgs {
  return {
    bypassOriginChallenge: wiring.bypassOriginChallenge,
    requiresClientCert: wiring.requiresClientCert,
    tlsProfile: wiring.tlsProfile,
    sessionCookies: wiring.sessionCookies,
  };
}

/**
 * Build the mediator-factory arg literal from the resolved wiring + companyId.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Args bundle accepted by every headless mediator factory.
 */
function buildMediatorArgsForWiring(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): TMediatorArgs {
  const identityArgs = toIdentityArgs(companyId, wiring);
  const graphqlArgs = toGraphqlArgs(wiring);
  const transportArgs = toTransportArgs(wiring);
  return { ...identityArgs, ...graphqlArgs, ...transportArgs };
}

/** Message when a bank misconfigures two identity transports at once. */
const TRANSPORT_CONFLICT_MSG =
  'Conflicting headless transport: node:https (client cert / TLS profile), native fetch and browser-TLS are mutually exclusive';

/**
 * Report whether the bank needs the node:https transport — a client
 * certificate, a ClientHello profile, or both.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity + GraphQL must run over node:https.
 */
function usesNodeTls(wiring: IHeadlessWiring): boolean {
  return wiring.requiresClientCert || wiring.tlsProfile !== undefined;
}

/**
 * Report whether the bank opted into Node's own fetch.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity REST must run over native fetch.
 */
function usesNativeFetch(wiring: IHeadlessWiring): boolean {
  return wiring.nativeFetch;
}

/**
 * Report whether the bank explicitly asked for browser TLS.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity REST must run through Camoufox.
 */
function usesBrowserTls(wiring: IHeadlessWiring): boolean {
  return wiring.requiresBrowserTls;
}

/** One transport rule: the first rule whose predicate holds picks the kind. */
interface ITransportRule {
  readonly kind: HeadlessTransportKind;
  readonly applies: (wiring: IHeadlessWiring) => boolean;
}

/** Ordered transport rules; a bank matching none runs browser-backed. */
const TRANSPORT_RULES: readonly ITransportRule[] = [
  { kind: 'node-tls', applies: usesNodeTls },
  { kind: 'native', applies: usesNativeFetch },
];

/** Every explicit transport declaration; a bank may make at most one. */
const TRANSPORT_DECLARATIONS = [usesNodeTls, usesNativeFetch, usesBrowserTls] as const;

/** Mediator factory per transport kind. */
const MEDIATOR_FACTORIES: Readonly<
  Record<HeadlessTransportKind, (args: TMediatorArgs) => IApiMediator>
> = {
  'node-tls': createMtlsHeadlessApiMediator,
  native: createHeadlessApiMediator,
  browser: createBrowserBackedHeadlessApiMediator,
};

/**
 * Guard against a bank requesting two mutually-exclusive identity transports.
 * node:https (client cert and/or TLS profile), native fetch and browser-TLS
 * (Camoufox) cannot share identity, so a config declaring more than one is a
 * wiring bug we fail fast.
 * @param companyId - Target bank company type (for the error message).
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when the transport selection is unambiguous.
 */
function assertSingleTransport(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): boolean {
  const declared = TRANSPORT_DECLARATIONS.filter((isDeclared): boolean => isDeclared(wiring));
  if (declared.length > 1) throw new ScraperError(`${TRANSPORT_CONFLICT_MSG} (${companyId})`);
  return true;
}

/**
 * Pick the transport kind from the ordered rule table.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns The first matching rule's kind, else the browser-backed default.
 */
function pickTransportKind(wiring: IHeadlessWiring): HeadlessTransportKind {
  const match = TRANSPORT_RULES.find((rule): boolean => rule.applies(wiring));
  return match?.kind ?? 'browser';
}

/**
 * Resolve the identity transport a bank's headless block selects, without
 * building a mediator. Shares {@link pickTransportKind} with
 * {@link selectHeadlessMediator}, so a caller asking "does this bank need a
 * browser?" gets the answer the runtime acts on.
 * @param companyId - Target bank company type.
 * @returns The transport kind, or false when the bank has no headless block.
 * @throws ScraperError when the headless block declares conflicting transports.
 */
function resolveHeadlessTransportKind(
  companyId: IPipelineContext['companyId'],
): HeadlessTransportKind | false {
  const wiring = resolveHeadlessWiring(companyId);
  if (wiring === false) return false;
  assertSingleTransport(companyId, wiring);
  return pickTransportKind(wiring);
}

/**
 * Select + invoke the headless mediator factory for the resolved wiring.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns A fully-wired IApiMediator for the bank's transport requirements.
 */
function selectHeadlessMediator(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): IApiMediator {
  assertSingleTransport(companyId, wiring);
  const args = buildMediatorArgsForWiring(companyId, wiring);
  const kind = pickTransportKind(wiring);
  return MEDIATOR_FACTORIES[kind](args);
}

/**
 * Resolve the ApiMediator Option for a descriptor: none() unless the
 * descriptor is headless AND the bank has a registered headless block.
 * @param descriptor - The pipeline descriptor (isHeadless flag + companyId).
 * @returns some(mediator) when applicable, else none().
 */
function resolveHeadlessApiMediator(descriptor: IPipelineDescriptor): Option<IApiMediator> {
  if (descriptor.isHeadless !== true) return none();
  const wiring = resolveHeadlessWiring(descriptor.options.companyId);
  if (wiring === false) return none();
  const apiMediator = selectHeadlessMediator(descriptor.options.companyId, wiring);
  return some(apiMediator);
}

export default resolveHeadlessApiMediator;
export type { HeadlessTransportKind };
export { resolveHeadlessApiMediator, resolveHeadlessTransportKind };
