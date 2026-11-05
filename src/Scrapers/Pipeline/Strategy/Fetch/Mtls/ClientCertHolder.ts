/**
 * The dynamic client-certificate holder (N26). A flow obtains its device
 * certificate at runtime and installs it here; the holder validates the pair,
 * builds an agent presenting it and destroys the agent it replaces. Its agent
 * source is asked on every request: the declared origin gets the installed
 * agent, every other origin (and every request before an install or after a
 * clear) gets a plain agent that presents no certificate. The pair lives only
 * in memory for the run.
 */

import { createPrivateKey, X509Certificate } from 'node:crypto';
import type { Agent } from 'node:https';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type {
  IClientCertControl,
  IClientCertPair,
} from '../../../Types/Domain/ClientCertControl.js';
import { fail, type Procedure, succeed } from '../../../Types/Procedure.js';
import { type AgentSource, type IAgentChoice, presentedOf } from './MtlsAgentSource.js';
import type { ICertBundle } from './OneZeroClientCert.js';

/** Builds the agent presenting a certificate, or none. */
type AgentBuilder = (cert: ICertBundle | false) => Agent;

/** A holder's per-request agent source and its certificate port. */
interface IClientCertHolder {
  readonly source: AgentSource;
  readonly control: IClientCertControl;
}

/** What a holder keeps: the installed choice under one key, beside the plain one. */
interface IHolderState {
  readonly origin: string;
  readonly plain: IAgentChoice;
  readonly buildAgent: AgentBuilder;
  readonly installed: Map<'cert', IAgentChoice>;
}

const INVALID_CERT = 'client certificate invalid';

/**
 * Pick the agent for a request URL.
 * @param state - Holder state.
 * @param url - Request URL.
 * @returns The installed choice for the declared origin, else the plain one.
 */
function pickAgent(state: IHolderState, url: string): IAgentChoice {
  const installed = state.installed.get('cert');
  if (installed === undefined) return state.plain;
  if (URL.parse(url)?.origin !== state.origin) return state.plain;
  return installed;
}

/**
 * Whether a pair parses and its certificate certifies its key.
 * @param pair - PEM key and certificate.
 * @returns True for a matching pair.
 */
function isMatchingPair(pair: IClientCertPair): boolean {
  try {
    const key = createPrivateKey(pair.key);
    const cert = new X509Certificate(pair.cert);
    return cert.checkPrivateKey(key);
  } catch {
    return false;
  }
}

/**
 * Install a pair, replacing (and destroying) the previous agent.
 * @param state - Holder state.
 * @param pair - PEM key and certificate.
 * @returns Success, or `client certificate invalid` keeping the previous pair.
 */
function installPair(state: IHolderState, pair: IClientCertPair): Procedure<true> {
  if (!isMatchingPair(pair)) return fail(ScraperErrorTypes.Generic, INVALID_CERT);
  const agent = state.buildAgent(pair);
  const presented = presentedOf(pair);
  const previous = state.installed.get('cert');
  state.installed.set('cert', { agent, presented });
  previous?.agent.destroy();
  return succeed(true);
}

/**
 * Drop the installed pair and destroy its agent.
 * @param state - Holder state.
 * @returns True.
 */
function clearPair(state: IHolderState): true {
  const previous = state.installed.get('cert');
  state.installed.delete('cert');
  previous?.agent.destroy();
  return true;
}

/**
 * Create a holder scoped to one origin.
 * @param origin - The exact https origin the certificate is presented to.
 * @param buildAgent - Builds the agent presenting a certificate, or none.
 * @returns The per-request agent source and the certificate port.
 */
function createClientCertHolder(origin: string, buildAgent: AgentBuilder): IClientCertHolder {
  const plain: IAgentChoice = { agent: buildAgent(false), presented: false };
  const state: IHolderState = { origin, plain, buildAgent, installed: new Map() };
  const source: AgentSource = pickAgent.bind(null, state);
  const install = installPair.bind(null, state);
  const clear = clearPair.bind(null, state);
  return { source, control: { install, clear } };
}

export type { AgentBuilder, IClientCertHolder };
export { createClientCertHolder };
