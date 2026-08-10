/**
 * Headless-mediator wiring — resolves which ApiMediator (if any) a headless
 * descriptor needs, and which identity transport it uses. OneZero presents a
 * bundled client certificate (mTLS via node:https); Pepper / PayBox route
 * identity REST through the Camoufox strategy. Extracted from
 * PipelineContextFactory to keep that file under the strict 150-LoC cap.
 */

import ScraperError from '../../Base/ScraperError.js';
import {
  createBrowserBackedHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
  type IApiMediator,
} from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IHeadlessUrlsConfig } from '../Registry/Config/PipelineBankConfigTypes.js';
import type { Option } from '../Types/Option.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Identity-transport flags decoded from the optional headless config block. */
interface IWiringFlags {
  readonly requiresBrowserTls: boolean;
  /** When true, wire the mTLS client-cert mediator instead of the Camoufox one. */
  readonly requiresClientCert: boolean;
  /** When true, the Camoufox strategy route-intercepts the initial origin nav. */
  readonly bypassOriginChallenge: boolean;
}

/** Pair of URLs + flags needed to wire the headless ApiMediator. */
interface IHeadlessWiring extends IWiringFlags {
  readonly identity: string;
  readonly graphql: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
}

/** Arg bundle accepted by both headless mediator factories. */
type TMediatorArgs = Parameters<typeof createBrowserBackedHeadlessApiMediator>[0];

/** Identity-transport slice of the mediator args. */
type TIdentityArgs = Pick<TMediatorArgs, 'bankHint' | 'identityBaseUrl' | 'identityOriginUrl'>;

/** GraphQL slice of the mediator args. */
type TGraphqlArgs = Pick<TMediatorArgs, 'graphqlUrl' | 'graphqlHeaders' | 'staticAuth'>;

/**
 * Decode the optional transport flags into explicit booleans.
 * @param headless - Headless URL block from PIPELINE_BANK_CONFIG.
 * @returns The three transport flags, each defaulted to false when absent.
 */
function toWiringFlags(headless: IHeadlessUrlsConfig): IWiringFlags {
  return {
    requiresBrowserTls: headless.requiresBrowserTls === true,
    requiresClientCert: headless.requiresClientCert === true,
    bypassOriginChallenge: headless.bypassOriginChallenge === true,
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
  return { identity: identityBase, graphql, graphqlHeaders, staticAuth, ...flags };
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
 * Build the mediator-factory arg literal from the resolved wiring + companyId.
 * @param companyId - Target bank company type.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns Args bundle accepted by both headless mediator factories.
 */
function buildMediatorArgsForWiring(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): TMediatorArgs {
  const identityArgs = toIdentityArgs(companyId, wiring);
  const graphqlArgs = toGraphqlArgs(wiring);
  return { ...identityArgs, ...graphqlArgs, bypassOriginChallenge: wiring.bypassOriginChallenge };
}

/** Message when a bank misconfigures two identity transports at once. */
const TRANSPORT_CONFLICT_MSG =
  'Conflicting headless transport: mTLS and browser-TLS are mutually exclusive';

/**
 * Guard against a bank requesting two mutually-exclusive identity transports.
 * mTLS (node:https client cert) and browser-TLS (Camoufox) cannot both drive
 * identity, so a config with both flags is a wiring bug we fail fast.
 * @param companyId - Target bank company type (for the error message).
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when the transport selection is unambiguous.
 */
function assertSingleTransport(
  companyId: IPipelineContext['companyId'],
  wiring: IHeadlessWiring,
): boolean {
  const hasConflict = wiring.requiresClientCert && wiring.requiresBrowserTls;
  if (hasConflict) throw new ScraperError(`${TRANSPORT_CONFLICT_MSG} (${companyId})`);
  return true;
}

/**
 * Select + invoke the headless mediator factory for the resolved wiring.
 * mTLS banks present a bundled client cert over node:https; all others route
 * identity REST through the Camoufox strategy.
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
  if (wiring.requiresClientCert) return createMtlsHeadlessApiMediator(args);
  return createBrowserBackedHeadlessApiMediator(args);
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
export { resolveHeadlessApiMediator };
