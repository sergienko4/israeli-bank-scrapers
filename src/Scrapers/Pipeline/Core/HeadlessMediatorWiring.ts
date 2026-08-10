/**
 * Headless-mediator wiring — resolves which ApiMediator (if any) a headless
 * descriptor needs, and which identity transport it uses. OneZero presents a
 * bundled client certificate (mTLS via node:https); Pepper / PayBox route
 * identity REST through the Camoufox strategy. Extracted from
 * PipelineContextFactory to keep that file under the strict 150-LoC cap.
 */

import {
  createBrowserBackedHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
  type IApiMediator,
} from '../Mediator/Api/ApiMediator.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { Option } from '../Types/Option.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Pair of URLs + flags needed to wire the headless ApiMediator. */
interface IHeadlessWiring {
  readonly identity: string;
  readonly graphql: string;
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  readonly staticAuth?: string;
  readonly requiresBrowserTls: boolean;
  /** When true, wire the mTLS client-cert mediator instead of the Camoufox one. */
  readonly requiresClientCert: boolean;
  /** When true, the Camoufox strategy route-intercepts the initial origin nav. */
  readonly bypassOriginChallenge: boolean;
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
  const headless = config.headless;
  return {
    identity: headless.identityBase,
    graphql: headless.graphql,
    graphqlHeaders: headless.graphqlHeaders,
    staticAuth: headless.staticAuth,
    requiresBrowserTls: headless.requiresBrowserTls === true,
    requiresClientCert: headless.requiresClientCert === true,
    bypassOriginChallenge: headless.bypassOriginChallenge === true,
  };
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
): Parameters<typeof createBrowserBackedHeadlessApiMediator>[0] {
  const identityOriginUrl = new URL(wiring.identity).origin;
  return {
    bankHint: companyId,
    identityBaseUrl: wiring.identity,
    identityOriginUrl,
    graphqlUrl: wiring.graphql,
    graphqlHeaders: wiring.graphqlHeaders,
    staticAuth: wiring.staticAuth,
    bypassOriginChallenge: wiring.bypassOriginChallenge,
  };
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
