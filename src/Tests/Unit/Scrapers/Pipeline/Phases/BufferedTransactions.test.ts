/**
 * Unit tests for Phase 12: Buffered Transaction Extraction.
 * Verifies tryBufferedResponse returns transactions from NetworkStore
 * without any network calls.
 * Rule #9: Tests first, then code.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { tryBufferedResponse } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeDispatch.js';
import type {
  IAccountFetchCtx,
  IPostFetchCtx,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { IApiFetchContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Whether the buffer gate returned data. */
type HasBuffered = boolean;

/**
 * Build a mock endpoint with optional responseBody.
 * @param responseBody - Parsed JSON response body or null.
 * @returns Mock IDiscoveredEndpoint.
 */
function mockEndpoint(responseBody: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://web.example.com/api/GetTransactionsList',
    method: 'POST',
    postData: '{}',
    responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: Date.now(),
  };
}

/**
 * Build a mock API context that tracks calls.
 * @returns Mock API with call tracking array.
 */
function mockApi(): IApiFetchContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    /**
     * Mock fetchPost — records call.
     * @param url - URL.
     * @returns Succeed with empty object.
     */
    fetchPost: <T>(url: string): Promise<Procedure<T>> => {
      calls.push(`POST ${url}`);
      const result = succeed({} as T);
      return Promise.resolve(result);
    },
    /**
     * Mock fetchGet — records call.
     * @param url - URL.
     * @returns Succeed with empty object.
     */
    fetchGet: <T>(url: string): Promise<Procedure<T>> => {
      calls.push(`GET ${url}`);
      const result = succeed({} as T);
      return Promise.resolve(result);
    },
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  };
}

/**
 * Build a mock fetch context.
 * @returns Mock IAccountFetchCtx.
 */
function mockFetchCtx(): IAccountFetchCtx {
  const api = mockApi();
  return {
    api,
    network: {
      /**
       * No endpoints in mock.
       * @returns Empty.
       */
      findEndpoints: (): readonly [] => [],
      /**
       * No services URL in mock.
       * @returns False.
       */
      getServicesUrl: (): false => false,
      /**
       * No endpoints in mock.
       * @returns Empty.
       */
      getAllEndpoints: (): readonly [] => [],
      /**
       * No SPA URL in mock.
       * @returns False.
       */
      discoverSpaUrl: (): false => false,
      /**
       * No patterns in mock.
       * @returns False.
       */
      discoverByPatterns: (): false => false,
      /**
       * No accounts endpoint in mock.
       * @returns False.
       */
      discoverAccountsEndpoint: (): false => false,
      /**
       * No transactions endpoint in mock.
       * @returns False.
       */
      discoverTransactionsEndpoint: (): false => false,
      /**
       * No balance endpoint in mock.
       * @returns False.
       */
      discoverBalanceEndpoint: (): false => false,
      /**
       * No auth token in mock.
       * @returns False.
       */
      discoverAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No origin in mock.
       * @returns False.
       */
      discoverOrigin: (): false => false,
      /**
       * No site ID in mock.
       * @returns False.
       */
      discoverSiteId: (): false => false,
      /**
       * Empty headers in mock.
       * @returns Default opts.
       */
      buildDiscoveredHeaders: () => Promise.resolve({ extraHeaders: {} }),
      /**
       * No transaction URL in mock.
       * @returns False.
       */
      buildTransactionUrl: (): false => false,
      /**
       * No balance URL in mock.
       * @returns False.
       */
      buildBalanceUrl: (): false => false,
      /**
       * No traffic in mock.
       * @returns False.
       */
      waitForTraffic: (): Promise<false> => Promise.resolve(false),
      /**
       * No txn traffic wait in mock.
       * @returns False.
       */
      waitForTransactionsTraffic: (): Promise<false> => Promise.resolve(false),
      /**
       * No auth cache in mock.
       * @returns False.
       */
      cacheAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No API origin in mock.
       * @returns False.
       */
      discoverApiOrigin: (): false => false,
      /**
       * No content match in mock.
       * @returns False.
       */
      discoverEndpointByContent: (): false => false,
      /**
       * No proxy endpoint in mock.
       * @returns False.
       */
      discoverProxyEndpoint: (): false => false,
    },
    startDate: '20260101',
  };
}

/**
 * Build a mock POST fetch context.
 * @returns Mock IPostFetchCtx.
 */
function mockPostCtx(): IPostFetchCtx {
  return {
    baseBody: {},
    url: 'https://web.example.com/api/GetTransactionsList',
    displayId: '1234',
    accountId: 'card-001',
  };
}

describe('tryBufferedResponse', () => {
  it('returns false when endpoint has no responseBody', async () => {
    const fc = mockFetchCtx();
    const endpoint = mockEndpoint(null);
    const post = mockPostCtx();

    const result = await tryBufferedResponse(fc, { endpoint, postCtx: post });

    const hasBuffered: HasBuffered = result !== false;
    expect(hasBuffered).toBe(false);
  });

  it('returns false when responseBody has no extractable transactions', async () => {
    const fc = mockFetchCtx();
    const endpoint = mockEndpoint({ status: 'ok', data: {} });
    const post = mockPostCtx();

    const result = await tryBufferedResponse(fc, { endpoint, postCtx: post });

    const hasBuffered: HasBuffered = result !== false;
    expect(hasBuffered).toBe(false);
  });

  it('returns account with transactions when responseBody has valid txn data', async () => {
    const txnPayload = {
      result: [
        {
          transactionDate: '2026-01-15',
          originalAmount: 100,
          chargedAmount: 100,
          description: 'Test Purchase',
          identifier: 12345,
        },
        {
          transactionDate: '2026-01-16',
          originalAmount: 200,
          chargedAmount: 200,
          description: 'Another Purchase',
          identifier: 12346,
        },
      ],
    };
    const fc = mockFetchCtx();
    const endpoint = mockEndpoint(txnPayload);
    const post = mockPostCtx();

    const result = await tryBufferedResponse(fc, { endpoint, postCtx: post });

    const hasBuffered: HasBuffered = result !== false;
    expect(hasBuffered).toBe(true);
    if (result !== false) {
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.txns.length).toBeGreaterThan(0);
        expect(result.value.accountNumber).toBe('1234');
      }
    }
  });

  it('does not call the network API', async () => {
    const txnPayload = {
      result: [
        { transactionDate: '2026-01-15', originalAmount: 50, chargedAmount: 50, description: 'Tx' },
      ],
    };
    const fc = mockFetchCtx();
    const api = fc.api as IApiFetchContext & { readonly calls: string[] };
    const endpoint = mockEndpoint(txnPayload);
    const post = mockPostCtx();

    await tryBufferedResponse(fc, { endpoint, postCtx: post });

    expect(api.calls).toHaveLength(0);
  });

  it('falls back to truthy accountNumber when displayId and accountId are empty', async () => {
    const txnPayload = {
      result: [
        { transactionDate: '2026-01-15', originalAmount: 75, chargedAmount: 75, description: 'Tx' },
      ],
    };
    const fc = mockFetchCtx();
    const endpoint = mockEndpoint(txnPayload);
    const emptyPost: IPostFetchCtx = {
      baseBody: {},
      url: 'https://web.example.com/api/GetTransactionsList',
      displayId: '',
      accountId: '',
    };

    const result = await tryBufferedResponse(fc, { endpoint, postCtx: emptyPost });

    const hasBuffered: HasBuffered = result !== false;
    expect(hasBuffered).toBe(true);
    if (result !== false && result.success) {
      const isTruthy: HasBuffered = Boolean(result.value.accountNumber);
      expect(isTruthy).toBe(true);
      expect(result.value.txns.length).toBeGreaterThan(0);
    }
  });
});
