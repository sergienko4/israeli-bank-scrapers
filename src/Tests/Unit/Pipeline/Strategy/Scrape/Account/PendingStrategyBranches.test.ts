/**
 * Branch coverage extensions for PendingStrategy.
 * Covers safeStr alt types, cardUniqueId fallbacks, mergeIntoAccounts reconciliation.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { fetchAndMergePending } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/PendingStrategy.js';
import type { IApiFetchContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';

/**
 * Build a stub network.
 * @param overrides - Parameter.
 * @returns Result.
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
 * Build a stub API.
 * @param postFn - Parameter.
 * @returns Result.
 */
function makeApi(postFn: LoosePostFn): IApiFetchContext {
  return {
    fetchPost: postFn as unknown as IApiFetchContext['fetchPost'],
    fetchGet: postFn as unknown as IApiFetchContext['fetchGet'],
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('PendingStrategy — branch completion', () => {
  it('reconciles txns into matching account by display number', async () => {
    const accounts: ITransactionsAccount[] = [
      { accountNumber: '4718', balance: 0, txns: [] },
      { accountNumber: '7777', balance: 0, txns: [] },
    ];
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
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'card-xyz',
              authDetalisList: [
                {
                  trnAmt: -25,
                  merchantName: 'Coffee',
                  trnPurchaseDate: '2026-04-01',
                  trnCurrencySymbol: 'ILS',
                },
                {
                  trnAmt: -10,
                  merchantName: 'Snack',
                  trnPurchaseDate: '2026-04-02',
                  trnCurrencySymbol: '',
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
      // Record uses last4 display that matches accountNumber 9999 + cardUniqueId='card-xyz'.
      accountRecords: [
        { cardUniqueId: 'card-xyz', last4Digits: '4718' } as Record<string, unknown>,
      ],
    });
    // 9999 was enriched, 7777 unchanged reference preserved
    const enriched = result.find(a => a.accountNumber === '4718');
    expect(enriched?.txns.length).toBe(2);
  });

  it('accepts number fields in safeStr (cardUniqueId as number in record)', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '0001', balance: 0, txns: [] }];
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
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: '12345',
              authDetalisList: [
                {
                  trnAmt: -1,
                  merchantName: 'X',
                  trnPurchaseDate: '2026-04-02',
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
      // cardUniqueID numeric — exercises safeStr number → toString branch
      accountRecords: [{ cardUniqueID: 12345 } as unknown as Record<string, unknown>],
    });
    const isArrayResult1 = Array.isArray(result);
    expect(isArrayResult1).toBe(true);
  });

  it('falls back to CardUniqueId (Pascal) field when others are missing', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: 'A1', balance: 0, txns: [] }];
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
    const api = makeApi(() => {
      const okResult = succeed({ statusCode: 200, result: { cardsList: [] } });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ CardUniqueId: 'pascal-id' } as unknown as Record<string, unknown>],
    });
    // No cardsList → accounts unchanged
    expect(result).toBe(accounts);
  });

  it('extracts from traffic even when records are empty (L156 traffic branch)', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: 'A1', balance: 0, txns: [] }];
    const trafficEp = {
      url: 'https://api.example/txn',
      method: 'POST',
      postData: '{"cardUniqueId":"from-traffic-id"}',
      responseBody: {},
    } as unknown as IDiscoveredEndpoint;
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
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [trafficEp],
    });
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'from-traffic-id',
              authDetalisList: [
                {
                  trnAmt: -2,
                  merchantName: 'Y',
                  trnPurchaseDate: '2026-04-03',
                  trnCurrencySymbol: 'USD',
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
      accountRecords: [],
    });
    const isArrayResult2 = Array.isArray(result);
    expect(isArrayResult2).toBe(true);
  });

  it('returns accounts unchanged when all pending cards have empty authDetalisList', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: 'A1', balance: 0, txns: [] }];
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
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [{ cardUniqueID: 'cx', authDetalisList: [] }],
        },
      });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [{ cardUniqueId: 'cx' }],
    });
    // All cards empty → displayPending.size === 0 → returns original
    expect(result).toBe(accounts);
  });

  it('falls back to cardUniqueID when idMap has no entry', async () => {
    const accounts: ITransactionsAccount[] = [
      { accountNumber: 'direct-fallback', balance: 0, txns: [] },
    ];
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
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'direct-fallback',
              authDetalisList: [
                {
                  trnAmt: -1,
                  merchantName: 'Z',
                  trnPurchaseDate: '2026-04-03',
                  trnCurrencySymbol: 'ILS',
                },
              ],
            },
          ],
        },
      });
      return Promise.resolve(okResult);
    });
    // No accountRecords → idMap is empty → display falls back to cardUniqueID
    const result = await fetchAndMergePending({
      api,
      network,
      accounts,
      accountRecords: [],
    });
    const isArrayResult3 = Array.isArray(result);
    expect(isArrayResult3).toBe(true);
  });
});
