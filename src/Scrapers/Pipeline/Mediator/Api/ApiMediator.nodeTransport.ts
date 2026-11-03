/**
 * The agent source a node:https mediator's identity and GraphQL transports
 * share. A bank declaring a dynamic client certificate gets an
 * origin-scoped holder whose port the flow installs the certificate through;
 * any other node:https bank gets one agent presenting its registered
 * certificate (or none). Every agent carries the bank's ClientHello profile.
 * Split from ApiMediator.factories to keep that file under the 150-LoC cap.
 */

import {
  type AgentBuilder,
  createClientCertHolder,
} from '../../Strategy/Fetch/Mtls/ClientCertHolder.js';
import { resolveClientCert } from '../../Strategy/Fetch/Mtls/ClientCertRegistry.js';
import {
  type AgentSource,
  fixedAgentSource,
  presentedOf,
} from '../../Strategy/Fetch/Mtls/MtlsAgentSource.js';
import { buildMtlsAgent } from '../../Strategy/Fetch/Mtls/MtlsTransport.js';
import type { ICertBundle } from '../../Strategy/Fetch/Mtls/OneZeroClientCert.js';
import {
  type TlsClientProfileKind,
  warnIfTlsProfileUnsupported,
} from '../../Strategy/Fetch/Tls/TlsClientProfiles.js';
import type { IClientCertControl } from '../../Types/Domain/ClientCertControl.js';
import type { INodeTlsMediatorArgs } from './ApiMediator.headless.types.js';

/**
 * Resolves the client certificate a node:https mediator presents.
 * @param args - Mediator args bundle (bank + client-cert flag).
 * @returns The bank's registered certificate, or false when none is required.
 */
function resolveTransportCert(args: INodeTlsMediatorArgs): ICertBundle | false {
  if (args.requiresClientCert !== true) return false;
  return resolveClientCert(args.bankHint);
}

/** The agent source a node:https mediator's transports share, and its certificate port. */
interface ITransportSource {
  readonly source: AgentSource;
  /** The dynamic client-certificate port, or false for a static transport. */
  readonly control: IClientCertControl | false;
}

/**
 * Resolve the mediator's ClientHello profile, warning once when the runtime
 * cannot emit it.
 * @param args - Mediator args bundle (TLS profile).
 * @returns The profile every agent of this mediator presents.
 */
function profileOf(args: INodeTlsMediatorArgs): TlsClientProfileKind {
  const tlsProfile = args.tlsProfile ?? 'node-default';
  warnIfTlsProfileUnsupported(tlsProfile, process.versions.openssl);
  return tlsProfile;
}

/**
 * Bind a ClientHello profile into an agent builder.
 * @param tlsProfile - Registered ClientHello profile to present.
 * @returns Builds the agent presenting a certificate (or none) with the profile.
 */
function agentBuilderFor(tlsProfile: TlsClientProfileKind): AgentBuilder {
  /**
   * Build one agent with the bound profile.
   * @param cert - PEM cert + key to present, or false for none.
   * @returns HTTPS agent.
   */
  const build: AgentBuilder = cert => buildMtlsAgent(cert, tlsProfile);
  return build;
}

/**
 * A source sharing one agent that presents the bank's registered certificate.
 * @param args - Mediator args bundle (bank + client-cert flag).
 * @param buildAgent - Builds the agent with the mediator's profile.
 * @returns The fixed source; no certificate port.
 */
function fixedTransportSource(
  args: INodeTlsMediatorArgs,
  buildAgent: AgentBuilder,
): ITransportSource {
  const clientCert = resolveTransportCert(args);
  const agent = buildAgent(clientCert);
  const presented = presentedOf(clientCert);
  const source = fixedAgentSource(agent, presented);
  return { source, control: false };
}

/**
 * Build the agent source a mediator's identity and GraphQL transports share:
 * a dynamic certificate holder when the bank declares one, else one agent.
 * @param args - Mediator args bundle (bank, certificate, TLS profile).
 * @returns The agent source and, when dynamic, the certificate port.
 */
function buildTransportSource(args: INodeTlsMediatorArgs): ITransportSource {
  const tlsProfile = profileOf(args);
  const buildAgent = agentBuilderFor(tlsProfile);
  if (args.clientCert === undefined) return fixedTransportSource(args, buildAgent);
  return createClientCertHolder(args.clientCert.origin, buildAgent);
}

export default buildTransportSource;
export { buildTransportSource };
