/**
 * GraphQL fetch strategy — transport-only.
 * Shapes a {query, variables} POST body over the base URL via NativeFetchStrategy.
 * Response unwrapping (e.g. {data, errors}) lives in the ApiMediator, NOT here.
 *
 * An optional default-header bag is merged UNDER each call's `extraHeaders`
 * (per-call wins), mirroring {@link DefaultHeadersFetchStrategy}. It exists
 * because some GraphQL gateways sit behind an edge WAF that allow-lists a
 * specific client identity on EVERY request — including the post-auth probe,
 * which carries no shape-level headers. Banks declare the bag as data in
 * `PipelineBankConfig.headless.graphqlHeaders`; an empty bag is byte-identical
 * to not passing one (OCP — no bank branching in this layer).
 */

import type { Procedure } from '../../Types/Procedure.js';
import type { DefaultHeaders } from './DefaultHeadersFetchStrategy.js';
import { mergeUnder } from './DefaultHeadersFetchStrategy.js';
import type { IFetchOpts, PostData } from './FetchStrategy.js';
import { NativeFetchStrategy } from './NativeFetchStrategy.js';

/** Default opts used when the caller passes no extraHeaders. */
const EMPTY_OPTS: IFetchOpts = { extraHeaders: {} };

/** GraphQL transport — thin POST wrapper with {query, variables} body shape. */
class GraphQLFetchStrategy extends NativeFetchStrategy {
  private readonly _defaultHeaders: DefaultHeaders;

  /**
   * Bind the strategy to a GraphQL endpoint and an optional header floor.
   * @param baseUrl - GraphQL endpoint every operation is POSTed to.
   * @param defaultHeaders - Headers merged under each call's extraHeaders.
   */
  constructor(baseUrl: string, defaultHeaders: DefaultHeaders = {}) {
    super(baseUrl);
    this._defaultHeaders = defaultHeaders;
  }

  /**
   * Execute a GraphQL operation by POSTing {query, variables} to the base URL.
   * @param query - GraphQL operation source (opaque string to this layer).
   * @param variables - Variables map passed verbatim under the 'variables' key.
   * @param opts - Optional fetch opts; extraHeaders propagate (e.g., Authorization).
   * @returns Procedure with the raw parsed response body (unwrap in ApiMediator).
   */
  public query<T>(
    query: string,
    variables: Record<string, unknown>,
    opts?: IFetchOpts,
  ): Promise<Procedure<T>> {
    const body: PostData = { query, variables: variables };
    const callOpts = opts ?? EMPTY_OPTS;
    const merged = mergeUnder(this._defaultHeaders, callOpts);
    return this.fetchPost<T>(this._baseUrl, body, merged);
  }
}

export default GraphQLFetchStrategy;
export { GraphQLFetchStrategy };
