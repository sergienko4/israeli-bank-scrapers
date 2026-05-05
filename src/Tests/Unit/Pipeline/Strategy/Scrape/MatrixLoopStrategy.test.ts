/**
 * Unit tests for MatrixLoopStrategy — guard clauses (not-applicable paths).
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { tryMatrixLoop } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/MatrixLoopStrategy.js';
import type { IAccountFetchCtx } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { IApiFetchContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a stub fetch context.
 * @param endpoint - Endpoint returned by discoverTransactionsEndpoint.
 * @returns IAccountFetchCtx.
 */
function makeFc(endpoint: IDiscoveredEndpoint | false): IAccountFetchCtx {
  const network = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => endpoint,
  } as unknown as INetworkDiscovery;
  return {
    api: {} as IApiFetchContext,
    network,
    startDate: '20260101',
  };
}

describe('tryMatrixLoop', () => {
  it('returns false when no txn endpoint discovered', async () => {
    const result = await tryMatrixLoop({
      fc: makeFc(false),
      accountId: 'a',
      displayId: '1',
    });
    expect(result).toBe(false);
  });

  it('returns false when txn endpoint has no postData', async () => {
    const ep = { url: 'u', method: 'POST', postData: '', responseBody: {} };
    const result = await tryMatrixLoop({
      fc: makeFc(ep as unknown as IDiscoveredEndpoint),
      accountId: 'a',
      displayId: '1',
    });
    expect(result).toBe(false);
  });

  it('returns false when postData is not a monthly endpoint', async () => {
    const ep = { url: 'u', method: 'POST', postData: '{"foo":"bar"}', responseBody: {} };
    const result = await tryMatrixLoop({
      fc: makeFc(ep as unknown as IDiscoveredEndpoint),
      accountId: 'a',
      displayId: '1',
    });
    expect(result).toBe(false);
  });

  it('resolves to a 0-txn account when the monthly endpoint yields no rows', async () => {
    // Include monthly WK keys so isMonthlyEndpoint returns true.
    const body = { month: 1, year: 2026, accountId: 'a' };
    const ep = {
      url: 'https://bank.example/api/txn',
      method: 'POST',
      postData: JSON.stringify(body),
      responseBody: {},
    } as unknown as IDiscoveredEndpoint;
    const api = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      fetchPost: (): { success: false; errorType: string; errorMessage: string } => ({
        success: false,
        errorType: 'Generic',
        errorMessage: 'fail',
      }),
    };
    const fc = {
      api,
      network: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        discoverTransactionsEndpoint: (): IDiscoveredEndpoint => ep,
        /**
         * Empty endpoint list — exercises the 0-balance path.
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
        /**
         * No balance URL discoverable.
         * @returns False.
         */
        buildBalanceUrl: (): false => false,
      },
      startDate: '20260101',
    } as unknown as IAccountFetchCtx;
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    // Matrix applied + iterated → returns Procedure with 0-txn account
    // (do NOT fall through to scrapePostDirect — its un-templated body
    // would echo the captured leading card onto every empty sibling).
    expect(result).not.toBe(false);
    if (result !== false && result.success) {
      expect(result.value.txns.length).toBe(0);
    }
  });
});
