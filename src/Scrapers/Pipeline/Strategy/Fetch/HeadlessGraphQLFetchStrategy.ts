/**
 * Enforces opted-in response integrity for GraphQL on the headless native transport.
 */

import { NETWORK_FETCH_TIMEOUT_MS } from '../../Mediator/Network/FetchConfig.js';
import type { IFetchOpts } from './FetchStrategy.js';
import { GraphQLFetchStrategy } from './GraphQLFetchStrategy.js';
import { makeInvokeCapped } from './HeadlessNativeFetchStrategy.js';
import type { IDispatch, TRequest } from './NativeFetchStrategy.js';

/** GraphQL transport that caps opted-in response reads. */
class HeadlessGraphQLFetchStrategy extends GraphQLFetchStrategy {
  protected _supportsResponseIntegrity = true;

  /**
   * Binds a bounded reader only when this GraphQL call has an integrity policy.
   * @param request - Request built by the inherited verb method.
   * @param opts - Call policy and hooks.
   * @returns The request-local transport run.
   */
  protected toRun(request: TRequest, opts: IFetchOpts): IDispatch {
    const run = super.toRun(request, opts);
    if (run.reading.responseIntegrity === undefined) return run;
    const invoke = makeInvokeCapped(
      NETWORK_FETCH_TIMEOUT_MS,
      run.reading,
      this._isConnectRetryDisabled,
    );
    return { ...run, invoke };
  }
}

export default HeadlessGraphQLFetchStrategy;
export { HeadlessGraphQLFetchStrategy };
