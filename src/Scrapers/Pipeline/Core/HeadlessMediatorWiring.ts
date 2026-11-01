/**
 * Headless-mediator wiring — resolves which ApiMediator (if any) a headless
 * descriptor needs, and which identity transport it uses. An ordered rule
 * table picks the transport: a bank that needs a client certificate and/or a
 * TLS ClientHello profile (OneZero) runs over node:https; a bank that opts in
 * with `nativeFetch` runs over Node's own fetch; every other bank (Pepper /
 * PayBox) routes identity REST through the Camoufox strategy. Extracted from
 * PipelineContextFactory to keep that file under the strict 150-LoC cap.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import {
  createBrowserBackedHeadlessApiMediator,
  createHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
  type IApiMediator,
} from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IHeadlessUrlsConfig } from '../Registry/Config/PipelineBankConfigTypes.js';
import type { Option } from '../Types/Option.js';
import { none, some } from '../Types/Option.js';
import { assertSingleTransport, pickTransportKind } from './HeadlessTransportRules.js';
import type {
  HeadlessTransportKind,
  IHeadlessWiring,
  IWiringFlags,
} from './HeadlessWiringTypes.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
/** Arg bundle accepted by every headless mediator factory (superset of each). */
type TMediatorArgs = Parameters<typeof createBrowserBackedHeadlessApiMediator>[0] &
  Parameters<typeof createMtlsHeadlessApiMediator>[0];

/** Identity-transport slice of the mediator args. */
type TIdentityArgs = Pick<TMediatorArgs, 'bankHint' | 'identityBaseUrl' | 'identityOriginUrl'>;

/** GraphQL slice of the mediator args. */
type TGraphqlArgs = Pick<TMediatorArgs, 'graphqlUrl' | 'graphqlHeaders' | 'staticAuth'>;

/** Transport-requirement slice of the mediator args, optional settings included. */
type TTransportArgs = IHeadlessWiring['transport'] &
  Pick<
    TMediatorArgs,
    'bypassOriginChallenge' | 'requiresClientCert' | 'sessionCookies' | 'omitBankText'
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
    isBankTextOmitted: headless.omitBankText === true,
  };
}

/**
 * Map a headless config block onto the wiring shape the factories consume.
 * @param headless - Headless URL block from PIPELINE_BANK_CONFIG.
 * @returns Resolved wiring (URLs + decoded flags).
 */
function toHeadlessWiring(headless: IHeadlessUrlsConfig): IHeadlessWiring {
  const flags = toWiringFlags(headless);
  const { identityBase, graphql, graphqlHeaders, staticAuth } = headless;
  const { tlsProfile, clientCert, cookieDomains, redirectPolicy, statusPolicy } = headless;
  const urls = { identity: identityBase, graphql, graphqlHeaders, staticAuth };
  const policies = { redirectPolicy, statusPolicy, mediaTypes: headless.mediaTypes };
  const transport = { tlsProfile, clientCert, cookieDomains, ...policies };
  return { ...urls, transport, ...flags };
}

/**
 * Resolve identity + graphql URLs + transport flags from PIPELINE_BANK_CONFIG.
 * Returns false when the bank is not registered or has no headless block.
 * @param companyId - Target bank company type.
 * @returns Resolved wiring, or false when the lookup fails.
 */
function resolveHeadlessWiring(companyId: CompanyTypes): IHeadlessWiring | false {
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
function toIdentityArgs(companyId: CompanyTypes, wiring: IHeadlessWiring): TIdentityArgs {
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
 * @returns Origin-challenge bypass, client-cert and cookie jar flags, plus
 *   the TLS profile, the domain-jar allow-list and the redirect and
 *   status policies and HTTP-failure body omission.
 */
function toTransportArgs(wiring: IHeadlessWiring): TTransportArgs {
  return {
    ...wiring.transport,
    bypassOriginChallenge: wiring.bypassOriginChallenge,
    requiresClientCert: wiring.requiresClientCert,
    sessionCookies: wiring.sessionCookies,
    omitBankText: wiring.isBankTextOmitted,
  };
}

/**
 * Build the mediator-factory arg literal from the resolved wiring + companyId.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Args bundle accepted by every headless mediator factory.
 */
function buildMediatorArgsForWiring(
  companyId: CompanyTypes,
  wiring: IHeadlessWiring,
): TMediatorArgs {
  const identityArgs = toIdentityArgs(companyId, wiring);
  const graphqlArgs = toGraphqlArgs(wiring);
  const transportArgs = toTransportArgs(wiring);
  return { ...identityArgs, ...graphqlArgs, ...transportArgs };
}

/** Mediator factory per transport kind. */
const MEDIATOR_FACTORIES: Readonly<
  Record<HeadlessTransportKind, (args: TMediatorArgs) => IApiMediator>
> = {
  'node-tls': createMtlsHeadlessApiMediator,
  native: createHeadlessApiMediator,
  browser: createBrowserBackedHeadlessApiMediator,
};

/**
 * Resolve the identity transport a bank's headless block selects, without
 * building a mediator. Shares {@link pickTransportKind} with
 * {@link selectHeadlessMediator}, so a caller asking "does this bank need a
 * browser?" gets the answer the runtime acts on.
 * @param companyId - Target bank company type.
 * @returns The transport kind, or false when the bank has no headless block.
 * @throws ScraperError when the headless block declares conflicting transports.
 */
function resolveHeadlessTransportKind(companyId: CompanyTypes): HeadlessTransportKind | false {
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
function selectHeadlessMediator(companyId: CompanyTypes, wiring: IHeadlessWiring): IApiMediator {
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
export type { HeadlessTransportKind } from './HeadlessWiringTypes.js';
export { resolveHeadlessApiMediator, resolveHeadlessTransportKind };
