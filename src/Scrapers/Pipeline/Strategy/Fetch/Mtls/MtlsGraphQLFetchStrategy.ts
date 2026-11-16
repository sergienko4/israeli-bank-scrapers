/**
 * mTLS GraphQL fetch strategy — a GraphQLFetchStrategy that presents a client
 * certificate on every request. It replaces ONLY the transport seam (the
 * inherited `_invoke` field) with an mTLS transport; header-merge, query
 * dispatch, response parsing, cookie emission and logging are inherited
 * unchanged. Used for the OneZero GraphQL host behind Cloudflare mTLS.
 */

import type { IMtlsInvokeOptions } from '../../../Types/Domain/MtlsInvokeTypes.js';
import GraphQLFetchStrategy from '../GraphQLFetchStrategy.js';
import type { AgentSource } from './MtlsAgentSource.js';
import makeMtlsInvoke from './MtlsInvoke.js';

/** Optional GraphQL defaults: headers plus the per-execution mTLS settings. */
interface IMtlsGraphQLSettings {
  readonly headers?: Readonly<Record<string, string>>;
  readonly options?: IMtlsInvokeOptions;
}

/** GraphQL transport that performs mutual-TLS via an injected agent source. */
class MtlsGraphQLFetchStrategy extends GraphQLFetchStrategy {
  /**
   * Bind the strategy to a base URL, an mTLS agent source, and defaults.
   * @param baseUrl - GraphQL endpoint URL.
   * @param source - Picks the HTTPS agent (client cert + key) per request.
   * @param settings - Default headers and per-execution mTLS settings.
   */
  constructor(baseUrl: string, source: AgentSource, settings: IMtlsGraphQLSettings = {}) {
    super(baseUrl, settings.headers ?? {});
    this._invoke = makeMtlsInvoke(source, settings.options);
  }
}

export default MtlsGraphQLFetchStrategy;
