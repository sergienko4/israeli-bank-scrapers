/**
 * mTLS GraphQL fetch strategy — a GraphQLFetchStrategy that presents a client
 * certificate on every request. It replaces ONLY the transport seam (the
 * inherited `_invoke` field) with an mTLS transport; header-merge, query
 * dispatch, response parsing, cookie emission and logging are inherited
 * unchanged. Used for the OneZero GraphQL host behind Cloudflare mTLS.
 */

import type { DefaultHeaders } from '../DefaultHeadersFetchStrategy.js';
import { GraphQLFetchStrategy } from '../GraphQLFetchStrategy.js';
import type { AgentSource } from './MtlsAgentSource.js';
import { makeMtlsInvoke } from './MtlsTransport.js';

/** GraphQL transport that performs mutual-TLS via an injected agent source. */
class MtlsGraphQLFetchStrategy extends GraphQLFetchStrategy {
  /**
   * Bind the strategy to a base URL, an mTLS agent source, and default headers.
   * @param baseUrl - GraphQL endpoint URL.
   * @param source - Picks the HTTPS agent (client cert + key) per request.
   * @param defaultHeaders - Headers merged under each call's extraHeaders.
   */
  constructor(baseUrl: string, source: AgentSource, defaultHeaders: DefaultHeaders = {}) {
    super(baseUrl, defaultHeaders);
    this._invoke = makeMtlsInvoke(source);
  }
}

export default MtlsGraphQLFetchStrategy;
export { MtlsGraphQLFetchStrategy };
