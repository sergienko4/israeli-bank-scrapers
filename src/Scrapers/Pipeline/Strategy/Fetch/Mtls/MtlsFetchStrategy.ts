/**
 * mTLS REST fetch strategy — a NativeFetchStrategy that presents a client
 * certificate on every request. It replaces ONLY the transport seam
 * (the inherited `_invoke` field) with an mTLS transport; all response
 * parsing, non-2xx classification, Set-Cookie emission and PII-safe logging
 * are inherited unchanged. Used for the OneZero identity host behind
 * Cloudflare API Shield mutual-TLS, and for banks whose device certificate is
 * installed at runtime (the agent source picks the agent per request).
 */

import { NativeFetchStrategy } from '../NativeFetchStrategy.js';
import type { AgentSource } from './MtlsAgentSource.js';
import { makeMtlsInvoke } from './MtlsTransport.js';

/** REST transport that performs mutual-TLS via an injected agent source. */
class MtlsFetchStrategy extends NativeFetchStrategy {
  /**
   * Bind the strategy to a base URL and an mTLS agent source.
   * @param baseUrl - Base URL for API requests.
   * @param source - Picks the HTTPS agent (client cert + key) per request.
   */
  constructor(baseUrl: string, source: AgentSource) {
    super(baseUrl);
    this._invoke = makeMtlsInvoke(source);
  }
}

export default MtlsFetchStrategy;
export { MtlsFetchStrategy };
