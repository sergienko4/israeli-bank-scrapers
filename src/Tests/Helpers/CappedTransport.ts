/**
 * Capped transport builders for tests. Production wires the same options from
 * PIPELINE_BANK_CONFIG; tests need them without the registry.
 */

import { NETWORK_FETCH_TIMEOUT_MS } from '../../Scrapers/Pipeline/Mediator/Network/FetchConfig.js';
import type { DefaultHeaders } from '../../Scrapers/Pipeline/Strategy/Fetch/DefaultHeadersFetchStrategy.js';
import { GraphQLFetchStrategy } from '../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import type { INativeFetchOptions } from '../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import {
  CAPPED_DEFAULT_HEADERS,
  NativeFetchStrategy,
} from '../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';

/** Options production hands the capped native transport. */
const CAP_DEFAULTS: INativeFetchOptions = {
  timeoutMs: NETWORK_FETCH_TIMEOUT_MS,
  defaultHeaders: CAPPED_DEFAULT_HEADERS,
};

/**
 * Build the capped native transport with production's defaults.
 * @param baseUrl - Base URL for API requests.
 * @param options - Test overrides (for example a lowered `timeoutMs`).
 * @returns A capped native strategy.
 */
function cappedNative(baseUrl: string, options: INativeFetchOptions = {}): NativeFetchStrategy {
  return new NativeFetchStrategy(baseUrl, { ...CAP_DEFAULTS, ...options });
}

/**
 * Build the capped GraphQL transport; it caps only operations with integrity.
 * @param baseUrl - GraphQL endpoint every operation is POSTed to.
 * @param defaultHeaders - Headers merged under each call's extraHeaders.
 * @param options - Test overrides (for example an integrity policy).
 * @returns A capped GraphQL strategy.
 */
function cappedGraphQL(
  baseUrl: string,
  defaultHeaders: DefaultHeaders = {},
  options: INativeFetchOptions = {},
): GraphQLFetchStrategy {
  const capped = { ...CAP_DEFAULTS, capOnlyWithIntegrity: true, ...options };
  return new GraphQLFetchStrategy(baseUrl, defaultHeaders, capped);
}

export { cappedGraphQL, cappedNative };
