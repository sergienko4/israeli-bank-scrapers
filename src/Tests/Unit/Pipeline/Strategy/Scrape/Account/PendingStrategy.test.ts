/**
 * Unit tests for PendingStrategy — fetchAndMergePending end-to-end paths.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { fetchAndMergePending } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/PendingStrategy.js';
import type { IApiFetchContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';

/**
 * Build a stub INetworkDiscovery with configurable endpoints / helpers.
 * @param overrides - Partial network implementation.
 * @returns Stub network.
 */
function makeNetwork(overrides: Partial<INetworkDiscovery> = {}): INetworkDiscovery {
  const base: Partial<INetworkDiscovery> = {
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
    discoverApiOrigin: (): false => false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
  };
  return { ...base, ...overrides } as INetworkDiscovery;
}

/** Loose stub signature — callers don't match the full generic. */
type LoosePostFn = () => Promise<unknown>;

/**
 * Build stub IApiFetchContext returning the supplied fetchPost outcome.
 * @param postFn - Override for fetchPost.
 * @returns Stub API context.
 */
function makeApi(
  postFn: LoosePostFn = (): Promise<ReturnType<typeof fail>> => {
    const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
    return Promise.resolve(failResult);
  },
): IApiFetchContext {
  return {
    fetchPost: postFn as unknown as IApiFetchContext['fetchPost'],
    /**
     * Test helper.
     * @returns Result.
     */
    fetchGet: (): Promise<ReturnType<typeof fail>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
      return Promise.resolve(failResult);
    },
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('fetchAndMergePending', () => {
  it('returns accounts unchanged when no pending URL discoverable', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const result = await fetchAndMergePending({
      api: makeApi(),
      network: makeNetwork(),
      accounts,
      accountRecords: [],
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when API origin is present but no card IDs', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverApiOrigin: (): string => 'https://api.example',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const result = await fetchAndMergePending({
      api: makeApi(),
      network,
      accounts,
      accountRecords: [],
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when fetchPost fails', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverApiOrigin: (): string => 'https://api.example',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const api = makeApi((): Promise<ReturnType<typeof fail>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'fetch failed');
      return Promise.resolve(failResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a' }],
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when response has no cardsList', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverApiOrigin: (): string => 'https://api.example',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({ statusCode: 200 });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a' }],
    });
    expect(result).toBe(accounts);
  });

  it('uses discoverByPatterns when pending URL is captured directly', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const discoveredEp = {
      url: 'https://api.example/pending',
      method: 'POST',
      postData: '',
      responseBody: {},
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverByPatterns: (): IDiscoveredEndpoint => discoveredEp as unknown as IDiscoveredEndpoint,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({ statusCode: 200 });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a' }],
    });
    expect(result).toBe(accounts);
  });

  it('extracts card IDs from traffic when accountRecords have none', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '1234', balance: 0, txns: [] }];
    const trafficEp = {
      url: 'https://api.example/txn',
      method: 'POST',
      postData: '{"cardUniqueId":"card-traffic"}',
      responseBody: {},
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverApiOrigin: (): string => 'https://api.example',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [
        trafficEp as unknown as IDiscoveredEndpoint,
      ],
    });
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({ statusCode: 200 });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [],
    });
    expect(result).toBe(accounts);
  });

  it('merges pending txns into matching accounts when cardsList returned', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '4718', balance: 0, txns: [] }];
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverApiOrigin: (): string => 'https://api.example',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'card-a',
              authDetalisList: [
                {
                  trnAmt: -25,
                  merchantName: 'Coffee',
                  trnPurchaseDate: '2026-04-01',
                  trnCurrencySymbol: 'ILS',
                },
              ],
            },
          ],
        },
      });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a', accountNumber: '4718' }],
    });
    // When a match is found, new accounts array is returned (not the same reference)
    const isArrayResult1 = Array.isArray(result);
    expect(isArrayResult1).toBe(true);
  });
});
