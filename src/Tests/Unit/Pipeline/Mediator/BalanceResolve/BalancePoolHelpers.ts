/**
 * Shared BALANCE-RESOLVE test factories — captured-pool mediator + api
 * stubs. Extracted so the captured-pool rescue test and the evidence-gate
 * regression test consume one source of truth (no duplicated test mocks).
 * Fake values only — no PII.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { type Option, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IApiFetchContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a fake endpoint pool wrapping the given response bodies.
 * @param bodies - Response bodies to wrap as captured endpoints.
 * @returns Array typed as discovered endpoints.
 */
function makePool(bodies: readonly unknown[]): readonly IDiscoveredEndpoint[] {
  return bodies.map((responseBody): IDiscoveredEndpoint => {
    return { responseBody } as unknown as IDiscoveredEndpoint;
  });
}

/**
 * Build a network stub whose pool returns the given endpoints.
 * @param pool - Captured endpoints.
 * @returns Network stub exposing getAllEndpoints.
 */
function makeNetworkStub(pool: readonly IDiscoveredEndpoint[]): IElementMediator['network'] {
  const stub = {
    /**
     * Return the captured endpoint pool.
     * @returns The pool.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => pool,
  };
  return stub as unknown as IElementMediator['network'];
}

/**
 * Build a mediator whose network pool returns the given endpoints.
 * @param pool - Captured endpoints.
 * @returns `some(mediator)` option for the context override.
 */
function makeMediatorWithPool(pool: readonly IDiscoveredEndpoint[]): Option<IElementMediator> {
  const network = makeNetworkStub(pool);
  return some({ network } as unknown as IElementMediator);
}

/**
 * Fetch stub that always fails (quarantine simulation).
 * @returns A failed procedure.
 */
function failingFetch(): Promise<Procedure<unknown>> {
  const failure = fail(ScraperErrorTypes.Generic, 'quarantined');
  return Promise.resolve(failure);
}

/**
 * Build an API context whose every fetch fails (quarantine simulation).
 * @returns Fake API context returning failures.
 */
function makeFailingApi(): IApiFetchContext {
  const stub = {
    fetchPost: failingFetch,
    fetchGet: failingFetch,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
  };
  return stub as unknown as IApiFetchContext;
}

/**
 * Build a per-URL-validating fetch context: returns the mapped body for an
 * EXACT synthesized URL (models a live 200) and a 4xx fail otherwise
 * (models the live server rejecting a replay / a quarantined redirect).
 * @param success - Map of exact live URL → 200 response body.
 * @returns Fake API context that validates per endpoint.
 */
function makePerUrlApi(success: ReadonlyMap<string, unknown>): IApiFetchContext {
  /**
   * Resolve one fetch by exact URL match.
   * @param url - Synthesized request URL.
   * @returns Mapped body as success, or a 4xx fail.
   */
  const run = (url: string): Promise<Procedure<unknown>> => {
    const hit = success.get(url);
    if (hit !== undefined) {
      const ok = succeed(hit);
      return Promise.resolve(ok);
    }
    const miss = fail(ScraperErrorTypes.Generic, `live 4xx ${url}`);
    return Promise.resolve(miss);
  };
  const stub = { fetchPost: run, fetchGet: run };
  return stub as unknown as IApiFetchContext;
}

export { makeFailingApi, makeMediatorWithPool, makePerUrlApi, makePool };
