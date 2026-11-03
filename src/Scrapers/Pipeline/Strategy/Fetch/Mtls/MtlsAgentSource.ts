/**
 * Agent sources — how an mTLS transport picks the HTTPS agent for each
 * request. A static transport shares one agent for every URL; a dynamic
 * client certificate swaps agents at runtime and scopes them to one origin,
 * so the transport asks its source on every request. Each choice also names
 * the certificate the agent presents, which the mocked-transport seam
 * observes in place of a real handshake.
 */

import { createHash, X509Certificate } from 'node:crypto';
import type { Agent } from 'node:https';

import type { ICertBundle } from './OneZeroClientCert.js';

/** The certificate an agent presents, named by the SHA-256 hex of its DER. */
interface IPresentedCert {
  readonly sha256: string;
}

/** The agent a request goes through and the certificate it presents. */
interface IAgentChoice {
  readonly agent: Agent;
  readonly presented: IPresentedCert | false;
}

/** Picks the agent for a request URL. */
type AgentSource = (url: string) => IAgentChoice;

/**
 * A source answering every URL with the same agent.
 * @param agent - The shared agent.
 * @param presented - The certificate it presents, or false for none.
 * @returns The fixed source.
 */
function fixedAgentSource(agent: Agent, presented: IPresentedCert | false): AgentSource {
  const choice: IAgentChoice = { agent, presented };
  /**
   * Answer the shared choice.
   * @returns The fixed agent choice.
   */
  const source: AgentSource = () => choice;
  return source;
}

/**
 * Name a PEM certificate by the SHA-256 of its DER.
 * @param certPem - PEM certificate (the leaf when a chain is given).
 * @returns The presented-certificate name.
 */
function digestOf(certPem: string): IPresentedCert {
  const { raw } = new X509Certificate(certPem);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  return { sha256 };
}

/**
 * Name the certificate a bundle presents.
 * @param cert - The bundle, or false for none.
 * @returns Its name, or false when there is none or it does not parse.
 */
function presentedOf(cert: ICertBundle | false): IPresentedCert | false {
  if (cert === false) return false;
  try {
    return digestOf(cert.cert);
  } catch {
    return false;
  }
}

export type { AgentSource, IAgentChoice, IPresentedCert };
export { fixedAgentSource, presentedOf };
