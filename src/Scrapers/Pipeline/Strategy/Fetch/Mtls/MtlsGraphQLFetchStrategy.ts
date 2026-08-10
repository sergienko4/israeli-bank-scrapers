/**
 * mTLS GraphQL fetch strategy — a GraphQLFetchStrategy that presents a client
 * certificate on every request. It replaces ONLY the transport seam (the
 * inherited `_invoke` field) with an mTLS transport; header-merge, query
 * dispatch, response parsing, cookie emission and logging are inherited
 * unchanged. Used for the OneZero GraphQL host behind Cloudflare mTLS.
 */

import type { Agent } from 'node:https';

import type { DefaultHeaders } from '../DefaultHeadersFetchStrategy.js';
import { GraphQLFetchStrategy } from '../GraphQLFetchStrategy.js';
import { makeMtlsInvoke } from './MtlsTransport.js';

/** GraphQL transport that performs mutual-TLS via an injected HTTPS agent. */
class MtlsGraphQLFetchStrategy extends GraphQLFetchStrategy {
  /**
   * Bind the strategy to a base URL, an mTLS agent, and default headers.
   * @param baseUrl - GraphQL endpoint URL.
   * @param agent - HTTPS agent carrying the client cert + key.
   * @param defaultHeaders - Headers merged under each call's extraHeaders.
   */
  constructor(baseUrl: string, agent: Agent, defaultHeaders: DefaultHeaders = {}) {
    super(baseUrl, defaultHeaders);
    this._invoke = makeMtlsInvoke(agent);
  }
}

export default MtlsGraphQLFetchStrategy;
export { MtlsGraphQLFetchStrategy };
