/**
 * Shared test helpers for Strategy/Scrape and Strategy/Fetch tests.
 * Typed factories for IApiFetchContext, INetworkDiscovery, endpoints, fetch contexts.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IAccountFetchCtx } from '../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { IApiFetchContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a stub IDiscoveredEndpoint with sensible defaults.
 * @param overrides - Partial endpoint fields.
 * @returns Fully-formed stub endpoint.
 */
export function makeEndpoint(overrides: Partial<IDiscoveredEndpoint> = {}): IDiscoveredEndpoint {
  const base = {
    url: 'https://example.com/api',
    method: 'POST' as const,
    postData: '',
    responseBody: {},
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
  };
  return { ...base, ...overrides };
}

/**
 * Build a stub INetworkDiscovery with configurable overrides.
 * @param overrides - Partial network implementation.
 * @returns Stub network.
 */
export function makeNetwork(overrides: Partial<INetworkDiscovery> = {}): INetworkDiscovery {
  const base: Partial<INetworkDiscovery> = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    findEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getServicesUrl: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverSpaUrl: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverByPatterns: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverAccountsEndpoint: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverTransactionsEndpoint: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverBalanceEndpoint: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverAuthToken: (): Promise<false> => Promise.resolve(false),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverOrigin: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverSiteId: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    buildDiscoveredHeaders: () => Promise.resolve({ extraHeaders: {} }),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    buildTransactionUrl: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    buildBalanceUrl: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    waitForTraffic: (): Promise<false> => Promise.resolve(false),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverEndpointByContent: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverApiOrigin: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    cacheAuthToken: (): Promise<false> => Promise.resolve(false),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverProxyEndpoint: (): false => false,
  };
  return { ...base, ...overrides } as INetworkDiscovery;
}

/**
 * Build a stub IApiFetchContext.
 * @param overrides - Partial field overrides.
 * @returns Stub API context.
 */
export function makeApi(overrides: Partial<IApiFetchContext> = {}): IApiFetchContext {
  const base = {
    /**
     * Test helper.
     * @returns Result.
     */
    fetchPost: <T>(): Promise<Procedure<T>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
      return Promise.resolve(failResult);
    },
    /**
     * Test helper.
     * @returns Result.
     */
    fetchGet: <T>(): Promise<Procedure<T>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
      return Promise.resolve(failResult);
    },
    accountsUrl: false as const,
    transactionsUrl: false as const,
    balanceUrl: false as const,
    pendingUrl: false as const,
    proxyUrl: false as const,
  };
  return { ...base, ...overrides };
}

/**
 * Build an IAccountFetchCtx using provided stubs.
 * @param api - API stub.
 * @param network - Network stub.
 * @param startDate - Start date (YYYYMMDD).
 * @returns Fetch context.
 */
export function makeFc(
  api: IApiFetchContext,
  network: INetworkDiscovery,
  startDate = '20260101',
): IAccountFetchCtx {
  return { api, network, startDate };
}

/**
 * Helper: fetchPost returning a successful JSON body.
 * @param body - Response body.
 * @returns Stub fetchPost that always succeeds.
 */
export function stubFetchPostOk(body: unknown): IApiFetchContext['fetchPost'] {
  /**
   * Test helper.
   * @returns Result.
   */
  const fn = (): Promise<Procedure<unknown>> => {
    const okResult = succeed(body);
    return Promise.resolve(okResult);
  };
  return fn as unknown as IApiFetchContext['fetchPost'];
}

/**
 * Helper: fetchGet returning a successful JSON body.
 * @param body - Response body.
 * @returns Stub fetchGet that always succeeds.
 */
export function stubFetchGetOk(body: unknown): IApiFetchContext['fetchGet'] {
  /**
   * Test helper.
   * @returns Result.
   */
  const fn = (): Promise<Procedure<unknown>> => {
    const okResult = succeed(body);
    return Promise.resolve(okResult);
  };
  return fn as unknown as IApiFetchContext['fetchGet'];
}

/**
 * Helper: fetchPost that always fails.
 * @returns Stub fetchPost that always fails.
 */
export function stubFetchPostFail(): IApiFetchContext['fetchPost'] {
  return <T>(): Promise<Procedure<T>> => {
    const failResult = fail(ScraperErrorTypes.Generic, 'post failed');
    return Promise.resolve(failResult);
  };
}

/**
 * Helper: fetchGet that always fails.
 * @returns Stub fetchGet that always fails.
 */
export function stubFetchGetFail(): IApiFetchContext['fetchGet'] {
  return <T>(): Promise<Procedure<T>> => {
    const failResult = fail(ScraperErrorTypes.Generic, 'get failed');
    return Promise.resolve(failResult);
  };
}
