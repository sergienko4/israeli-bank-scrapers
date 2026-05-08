/**
 * Unit tests for MatrixLoopStrategy — guard clauses (not-applicable paths).
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { tryMatrixLoop } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/MatrixLoopStrategy.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountFetchCtx,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type {
  IApiFetchContext,
  ITxnEndpoint,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a stub fetch context with a pre-resolved slim txnEndpoint
 * (Phase 7f: SCRAPE consumes the typed contract plumbed onto fc by
 * SCRAPE.PRE).
 *
 * @param endpoint - Slim TXN endpoint; pass `EMPTY_TXN_ENDPOINT` when
 *   the test wants the no-endpoint default.
 * @returns IAccountFetchCtx.
 */
function makeFc(endpoint: ITxnEndpoint): IAccountFetchCtx {
  const network = {} as unknown as INetworkDiscovery;
  return {
    api: {} as IApiFetchContext,
    network,
    startDate: '20260101',
    txnEndpoint: endpoint,
  };
}

/**
 * Build a slim TXN endpoint stub from a partial override; defaults to
 * EMPTY for fields the test doesn't care about.
 *
 * @param overrides - Partial override fields.
 * @returns Slim TXN endpoint.
 */
function stubTxn(overrides: Partial<ITxnEndpoint>): ITxnEndpoint {
  return { ...EMPTY_TXN_ENDPOINT, ...overrides };
}

describe('tryMatrixLoop', () => {
  it('returns false when no txn endpoint discovered', async () => {
    const fc = makeFc(EMPTY_TXN_ENDPOINT);
    const result = await tryMatrixLoop({
      fc,
      accountId: 'a',
      displayId: '1',
    });
    expect(result).toBe(false);
  });

  it('returns false when txn endpoint has no templatePostData', async () => {
    const ep = stubTxn({ url: 'https://bank.fake/api', method: 'POST', templatePostData: '' });
    const fc = makeFc(ep);
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(result).toBe(false);
  });

  it('returns false when templatePostData is not a monthly endpoint', async () => {
    const ep = stubTxn({
      url: 'https://bank.fake/api',
      method: 'POST',
      templatePostData: '{"foo":"bar"}',
    });
    const fc = makeFc(ep);
    const result = await tryMatrixLoop({ fc, accountId: 'a', displayId: '1' });
    expect(result).toBe(false);
  });

  it('resolves to a 0-txn account when the monthly endpoint yields no rows', async () => {
    // Include monthly WK keys so isMonthlyEndpoint returns true.
    const body = { month: 1, year: 2026, accountId: 'a' };
    const ep = stubTxn({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      templatePostData: JSON.stringify(body),
    });
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
      txnEndpoint: ep,
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
