/**
 * GraphQL fetch strategy — transport-only.
 * Shapes a {query, variables} POST body over the base URL via NativeFetchStrategy.
 * Response unwrapping (e.g. {data, errors}) lives in the ApiMediator, NOT here.
 */

import type { Procedure } from '../../Types/Procedure.js';
import type { IFetchOpts, PostData } from './FetchStrategy.js';
import { NativeFetchStrategy } from './NativeFetchStrategy.js';

/** Default opts used when the caller passes no extraHeaders. */
const EMPTY_OPTS: IFetchOpts = { extraHeaders: {} };

/** GraphQL transport — thin POST wrapper with {query, variables} body shape. */
class GraphQLFetchStrategy extends NativeFetchStrategy {
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
    const body: PostData = { query, variables: variables as object };
    return this.fetchPost<T>(this._baseUrl, body, opts ?? EMPTY_OPTS);
  }
}

export default GraphQLFetchStrategy;
export { GraphQLFetchStrategy };
