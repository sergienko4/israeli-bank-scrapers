/**
 * mTLS REST fetch strategy — a NativeFetchStrategy that presents a client
 * certificate on every request. It replaces ONLY the transport seam
 * (the inherited `_invoke` field) with an mTLS transport; all response
 * parsing, non-2xx classification, Set-Cookie emission and PII-safe logging
 * are inherited unchanged. Used for the OneZero identity host behind
 * Cloudflare API Shield mutual-TLS.
 */

import type { Agent } from 'node:https';

import { NativeFetchStrategy } from '../NativeFetchStrategy.js';
import { makeMtlsInvoke } from './MtlsTransport.js';

/** REST transport that performs mutual-TLS via an injected HTTPS agent. */
class MtlsFetchStrategy extends NativeFetchStrategy {
  /**
   * Bind the strategy to a base URL and a pre-built mTLS agent.
   * @param baseUrl - Base URL for API requests.
   * @param agent - HTTPS agent carrying the client cert + key.
   */
  constructor(baseUrl: string, agent: Agent) {
    super(baseUrl);
    this._invoke = makeMtlsInvoke(agent);
  }
}

export default MtlsFetchStrategy;
export { MtlsFetchStrategy };
