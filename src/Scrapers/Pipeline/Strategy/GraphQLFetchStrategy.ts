/**
 * GraphQL fetch strategy — wraps NativeFetchStrategy with query/variables.
 * Stub: returns fail('NOT_IMPLEMENTED') until Step 8.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/Procedure.js';
import { NativeFetchStrategy } from './NativeFetchStrategy.js';

/** GraphQL fetch — adds query method on top of NativeFetchStrategy. */
class GraphQLFetchStrategy extends NativeFetchStrategy {
  /**
   * Execute a GraphQL query (stub).
   * @param query - GraphQL query string.
   * @param variables - Query variables.
   * @returns Failure Procedure (stub).
   */
  public query<T>(query: string, variables: Record<string, string>): Promise<Procedure<T>> {
    const varCount = String(Object.keys(variables).length);
    const queryPreview = query.slice(0, 50);
    const base = this._baseUrl;
    const msg = `GraphQLFetchStrategy stub: query(${queryPreview}..., ${varCount} vars, ${base})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }
}

export default GraphQLFetchStrategy;
export { GraphQLFetchStrategy };
