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
import type {
  IApiFetchContext,
  ITxnEndpoint,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
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
    discoverApiOrigin: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    cacheAuthToken: (): Promise<false> => Promise.resolve(false),
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
    transactionsUrl: false as const,
    balanceUrl: false as const,
    pendingUrl: false as const,
    proxyUrl: false as const,
  };
  return { ...base, ...overrides };
}

/** Optional extras for {@link makeFc}. */
interface IMakeFcOpts {
  readonly startDate?: string;
  /**
   * Phase 7f: tests now supply the slim {@link ITxnEndpoint} the SCRAPE
   * pipeline expects. Legacy callers passed `IDiscoveredEndpoint` or
   * `false`; both are normalised to the EMPTY default here. Tests that
   * exercise endpoint-driven branches override with the slim shape.
   */
  readonly txnEndpoint?: ITxnEndpoint | IDiscoveredEndpoint | false;
}

/** Default empty TXN endpoint for tests that don't exercise the field. */
const EMPTY_TEST_TXN_ENDPOINT: ITxnEndpoint = {
  url: '',
  method: 'GET',
  templatePostData: false,
  fieldMap: {
    date: '',
    amount: '',
    description: '',
    currency: '',
    identifier: '',
    originalAmount: false,
    processedDate: false,
    balance: false,
  },
  pendingUrl: false,
  billingUrl: false,
};

/**
 * Adapt a test-supplied endpoint into the slim {@link ITxnEndpoint}
 * shape. Accepts either the slim type (passed through) or the legacy
 * `IDiscoveredEndpoint` (only `url`, `method`, `postData` carry over).
 * `false` and `undefined` collapse to the EMPTY default.
 *
 * @param raw - Test-supplied endpoint.
 * @returns Slim TXN endpoint suitable for IAccountFetchCtx.
 */
function adaptTestTxnEndpoint(raw: ITxnEndpoint | IDiscoveredEndpoint | false): ITxnEndpoint {
  if (raw === false) return EMPTY_TEST_TXN_ENDPOINT;
  if ('fieldMap' in raw) return raw;
  return {
    ...EMPTY_TEST_TXN_ENDPOINT,
    url: raw.url,
    method: raw.method === 'PUT' ? 'GET' : raw.method,
    templatePostData: raw.postData || false,
  };
}

/**
 * Build an IAccountFetchCtx using provided stubs. Phase 7f: the
 * fetch context carries the slim {@link ITxnEndpoint} the SCRAPE
 * strategies consume directly. Legacy `IDiscoveredEndpoint` mocks
 * passed via `opts.txnEndpoint` are adapted automatically.
 *
 * @param api - API stub.
 * @param network - Network stub.
 * @param opts - Optional startDate / txnEndpoint overrides.
 * @returns Fetch context.
 */
export function makeFc(
  api: IApiFetchContext,
  network: INetworkDiscovery,
  opts: IMakeFcOpts = {},
): IAccountFetchCtx {
  return {
    api,
    network,
    startDate: opts.startDate ?? '20260101',
    txnEndpoint: adaptTestTxnEndpoint(opts.txnEndpoint ?? false),
  };
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
