/**
 * API-mediator wiring — resolves which ApiMediator (if any) an API-direct
 * descriptor needs, and which identity transport it uses. An ordered rule
 * table picks the transport: a bank that needs a client certificate and/or a
 * TLS ClientHello profile (OneZero) runs over node:https; a bank that opts in
 * with `nativeFetch` runs over Node's own fetch (Pepper, PayBox and most
 * API-direct banks); a bank that declares neither fails closed with a wiring
 * error. Extracted from PipelineContextFactory to keep that file under the
 * strict 150-LoC cap.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import {
  createHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
  type IApiMediator,
} from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { ITransportConfig } from '../Registry/Config/PipelineBankConfigTypes.js';
import type { Option } from '../Types/Option.js';
import { none, some } from '../Types/Option.js';
import type { IApiWiring, IWiringFlags, TransportKind } from './ApiWiringTypes.js';
import { assertSingleTransport, pickTransportKind } from './HeadlessTransportRules.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Arg bundle accepted by every API-mediator factory (the node:https superset). */
type TMediatorArgs = Parameters<typeof createMtlsHeadlessApiMediator>[0];

/** Identity-transport slice of the mediator args. */
type TIdentityArgs = Pick<TMediatorArgs, 'bankHint' | 'identityBaseUrl'>;

/** GraphQL slice of the mediator args. */
type TGraphqlArgs = Pick<TMediatorArgs, 'graphqlUrl' | 'graphqlHeaders' | 'staticAuth'>;

/** Transport-requirement slice of the mediator args, optional settings included. */
type TTransportArgs = IApiWiring['transport'] &
  Pick<TMediatorArgs, 'requiresClientCert' | 'sessionCookies' | 'omitBankText'>;

/**
 * Decode the optional transport flags into explicit booleans.
 * @param cfg - Transport block from PIPELINE_BANK_CONFIG.
 * @returns The transport flags, each defaulted to false when absent.
 */
function toWiringFlags(cfg: ITransportConfig): IWiringFlags {
  return {
    requiresClientCert: cfg.requiresClientCert === true,
    nativeFetch: cfg.nativeFetch === true,
    sessionCookies: cfg.sessionCookies === true,
    isBankTextOmitted: cfg.omitBankText === true,
  };
}

/**
 * Extract the non-boolean transport options and policies from a transport block.
 * @param cfg - Transport block from PIPELINE_BANK_CONFIG.
 * @returns Transport options and response policies for the mediator factories.
 */
function toWiringTransport(cfg: ITransportConfig): IApiWiring['transport'] {
  const { redirectPolicy, statusPolicy, mediaTypes, responseIntegrity } = cfg;
  const policies = { redirectPolicy, statusPolicy, mediaTypes, strictUtf8: cfg.strictUtf8 };
  const { tlsProfile, clientCert, cookieDomains, isConnectRetryDisabled } = cfg;
  const options = { tlsProfile, clientCert, cookieDomains, isConnectRetryDisabled };
  return { ...options, ...policies, responseIntegrity };
}

/**
 * Map a transport config block onto the wiring shape the factories consume.
 * @param cfg - Transport block from PIPELINE_BANK_CONFIG.
 * @returns Resolved wiring (URLs + decoded flags).
 */
function toApiWiring(cfg: ITransportConfig): IApiWiring {
  const flags = toWiringFlags(cfg);
  const transport = toWiringTransport(cfg);
  const { identityBase, graphql, graphqlHeaders, staticAuth } = cfg;
  const urls = { identity: identityBase, graphql, graphqlHeaders, staticAuth };
  return { ...urls, transport, ...flags };
}

/**
 * Resolve identity + graphql URLs + transport flags from PIPELINE_BANK_CONFIG.
 * Returns false when the bank is not registered or has no headless block.
 * @param companyId - Target bank company type.
 * @returns Resolved wiring, or false when the lookup fails.
 */
function resolveApiWiring(companyId: CompanyTypes): IApiWiring | false {
  const config = resolvePipelineBankConfig(companyId);
  if (config === false || !config.transport) return false;
  return toApiWiring(config.transport);
}

/**
 * Build the identity-transport slice of the mediator args.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns bankHint plus the identity base URL.
 */
function toIdentityArgs(companyId: CompanyTypes, wiring: IApiWiring): TIdentityArgs {
  return { bankHint: companyId, identityBaseUrl: wiring.identity };
}

/**
 * Build the GraphQL slice of the mediator args.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns GraphQL endpoint plus its optional headers + static auth.
 */
function toGraphqlArgs(wiring: IApiWiring): TGraphqlArgs {
  const { graphql, graphqlHeaders, staticAuth } = wiring;
  return { graphqlUrl: graphql, graphqlHeaders, staticAuth };
}

/**
 * Build the transport-requirement slice of the mediator args.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Client-cert and cookie jar flags, plus the TLS profile, the
 *   domain-jar allow-list and the redirect and status policies and
 *   HTTP-failure body omission.
 */
function toTransportArgs(wiring: IApiWiring): TTransportArgs {
  return {
    ...wiring.transport,
    requiresClientCert: wiring.requiresClientCert,
    sessionCookies: wiring.sessionCookies,
    omitBankText: wiring.isBankTextOmitted,
  };
}

/**
 * Build the mediator-factory arg literal from the resolved wiring + companyId.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Args bundle accepted by every API-mediator factory.
 */
function buildMediatorArgsForWiring(companyId: CompanyTypes, wiring: IApiWiring): TMediatorArgs {
  const identityArgs = toIdentityArgs(companyId, wiring);
  const graphqlArgs = toGraphqlArgs(wiring);
  const transportArgs = toTransportArgs(wiring);
  return { ...identityArgs, ...graphqlArgs, ...transportArgs };
}

/** Mediator factory per transport kind. */
const MEDIATOR_FACTORIES: Readonly<Record<TransportKind, (args: TMediatorArgs) => IApiMediator>> = {
  'node-tls': createMtlsHeadlessApiMediator,
  native: createHeadlessApiMediator,
};

/**
 * Resolve the identity transport a bank's headless block selects, without
 * building a mediator. Shares {@link pickTransportKind} with
 * {@link selectApiMediator}, so a caller asking which transport a bank
 * runs gets the answer the runtime acts on.
 * @param companyId - Target bank company type.
 * @returns The transport kind, or false when the bank has no headless block.
 * @throws ScraperError when the headless block declares conflicting transports
 *   or none at all.
 */
function resolveTransportKind(companyId: CompanyTypes): TransportKind | false {
  const wiring = resolveApiWiring(companyId);
  if (wiring === false) return false;
  assertSingleTransport(companyId, wiring);
  return pickTransportKind(companyId, wiring);
}

/**
 * Select + invoke the API-mediator factory for the resolved wiring.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns A fully-wired IApiMediator for the bank's transport requirements.
 */
function selectApiMediator(companyId: CompanyTypes, wiring: IApiWiring): IApiMediator {
  assertSingleTransport(companyId, wiring);
  const args = buildMediatorArgsForWiring(companyId, wiring);
  const kind = pickTransportKind(companyId, wiring);
  return MEDIATOR_FACTORIES[kind](args);
}

/**
 * Resolve the ApiMediator Option for a descriptor: some(mediator) only when
 * the bank has a registered headless block.
 * @param descriptor - The pipeline descriptor (companyId).
 * @returns some(mediator) when applicable, else none().
 */
function resolveApiMediator(descriptor: IPipelineDescriptor): Option<IApiMediator> {
  const wiring = resolveApiWiring(descriptor.options.companyId);
  if (wiring === false) return none();
  const apiMediator = selectApiMediator(descriptor.options.companyId, wiring);
  return some(apiMediator);
}

export default resolveApiMediator;
export type { TransportKind } from './ApiWiringTypes.js';
export { resolveApiMediator, resolveTransportKind, selectApiMediator, toApiWiring };
