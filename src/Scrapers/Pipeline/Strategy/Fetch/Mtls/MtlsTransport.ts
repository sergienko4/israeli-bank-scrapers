/**
 * Mutual-TLS agents for hosts behind Cloudflare API Shield mTLS
 * (the OneZero identity + GraphQL hosts). The agent presents the optional
 * client certificate and shapes its ClientHello with the named profile; the
 * request path lives in {@link ./MtlsRequest.ts} and the fallback/timeout
 * policy in {@link ./MtlsInvoke.ts}.
 */

import type { Agent } from 'node:https';

import type { ICertBundle } from '../../../Types/Domain/CertBundle.js';
import checkServerCertificate from '../Tls/ServerCertificateFloor.js';
import { SessionProtocolAgent } from '../Tls/SessionProtocolAgent.js';
import { getTlsClientProfile, type TlsClientProfileKind } from '../Tls/TlsClientProfiles.js';

/**
 * Selects the agent's client-certificate options.
 * @param clientCert - PEM cert + key to present, or false to present none.
 * @returns The cert + key options, or no options when no cert is presented.
 */
function toCertOptions(clientCert: ICertBundle | false): Partial<ICertBundle> {
  if (clientCert === false) return {};
  return { cert: clientCert.cert, key: clientCert.key };
}

/**
 * Builds the keep-alive-off HTTPS agent a node:https transport sends through.
 * The agent presents the optional client certificate and shapes its
 * ClientHello with the named profile; the default profile leaves Node's stock
 * handshake untouched. Every agent enforces the server-certificate floor and
 * the profile's session protocol, so a profile that lowers OpenSSL's security
 * level for its handshake cannot lower the bar for the server's chain or for
 * the handshake signature.
 * @param clientCert - PEM cert + key to present, or false to present none.
 * @param tlsProfile - Registered ClientHello profile to present.
 * @returns An https.Agent carrying the certificate and profile options.
 */
function buildMtlsAgent(
  clientCert: ICertBundle | false,
  tlsProfile: TlsClientProfileKind = 'node-default',
): Agent {
  const { options, sessionProtocol } = getTlsClientProfile(tlsProfile);
  const certOptions = toCertOptions(clientCert);
  const checkServerIdentity = checkServerCertificate;
  const agentOptions = { ...options, ...certOptions, checkServerIdentity, keepAlive: false };
  return new SessionProtocolAgent(agentOptions, sessionProtocol);
}

export default buildMtlsAgent;
