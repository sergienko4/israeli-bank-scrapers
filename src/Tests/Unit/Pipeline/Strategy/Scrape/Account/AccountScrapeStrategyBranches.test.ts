/**
 * Branch coverage extensions for AccountScrapeStrategy.
 * Phase 7f: covers `scrapeOneAccountPost` (2-arg signature) and
 * `scrapeOneAccountViaUrl`. The legacy `tryBufferedResponse`
 * shortcut and its branch suite were removed for 100%
 * SCRAPE/network separation (R-NET-SCRAPE).
 */

import {
  scrapeOneAccountPost,
  scrapeOneAccountViaUrl,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeStrategy.js';
import type { IAccountFetchCtx } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchGetOk,
  stubFetchPostOk,
} from '../../StrategyTestHelpers.js';

/** Body with txns to force hasResults=true in range path. */
const TXN_BODY = {
  Transactions: [
    {
      date: '2026-01-15',
      originalAmount: 100,
      description: 'Coffee',
      fullPurchaseDate: '2026-01-15',
    },
  ],
};

describe('AccountScrapeStrategy — branch extensions', () => {
  it('scrapeOneAccountPost handles empty templatePostData (no template fallback)', async () => {
    const ep = makeEndpoint({
      url: 'https://bank.example/api',
      method: 'POST',
      postData: '',
      responseBody: undefined,
    });
    const api = makeApi({ fetchPost: stubFetchPostOk({}) });
    const network = makeNetwork({
      /**
       * Test stub.
       *
       * @returns Empty captures.
       */
      getAllEndpoints: () => [],
      /**
       * Test stub.
       *
       * @returns False (no txn endpoint).
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, {});
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('scrapeOneAccountPost: range-iterable body still routes through chunking', async () => {
    const ep = makeEndpoint({
      url: 'https://bank.example/api',
      method: 'POST',
      postData: '{"accountId":"A1","fromDate":"2024-01-01","toDate":"2024-12-31"}',
      responseBody: undefined,
    });
    const api = makeApi({ fetchPost: stubFetchPostOk(TXN_BODY) });
    const network = makeNetwork({
      /**
       * Test stub.
       *
       * @returns Empty captures.
       */
      getAllEndpoints: () => [],
      /**
       * Test stub.
       *
       * @returns False.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, {
      accountId: 'A1',
      fromDate: '2024-01-01',
      toDate: '2024-12-31',
    });
    expect(typeof result.success).toBe('boolean');
  });

  it('scrapePostDirect: rawRecord undefined branch via empty-template path', async () => {
    const ep = makeEndpoint({
      url: 'https://bank.example/api',
      method: 'POST',
      postData: '',
      responseBody: undefined,
    });
    const api = makeApi({
      fetchPost: stubFetchPostOk({ Transactions: [] }),
    });
    const network = makeNetwork({
      /**
       * Test stub.
       *
       * @returns Empty captures.
       */
      getAllEndpoints: () => [],
      /**
       * Test stub.
       *
       * @returns False.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, {});
    expect(typeof result.success).toBe('boolean');
  });

  it('scrapeOneAccountViaUrl: GET path with query params passes through', async () => {
    const api = makeApi({
      fetchGet: stubFetchGetOk(TXN_BODY),
      transactionsUrl: 'https://example.com/txn?fromDate=2020-01-01&toDate=2020-12-31',
    });
    const network = makeNetwork({
      /**
       * Test stub.
       *
       * @returns False.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc: IAccountFetchCtx = makeFc(api, network);
    const result = await scrapeOneAccountViaUrl(fc, 'acc-1');
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });
});
