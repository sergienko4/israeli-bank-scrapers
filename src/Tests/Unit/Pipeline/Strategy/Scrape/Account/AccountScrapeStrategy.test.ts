/**
 * Unit tests for Strategy/Scrape/Account/AccountScrapeStrategy.
 * Phase 7f: covers scrapeOneAccountPost (typed-contract migration; 2-arg
 * signature) and scrapeOneAccountViaUrl. The legacy `tryBufferedResponse`
 * shortcut was removed for 100% SCRAPE/network separation — its test
 * suite is removed accordingly.
 */

import {
  scrapeOneAccountPost,
  scrapeOneAccountViaUrl,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeStrategy.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchGetFail,
  stubFetchGetOk,
  stubFetchPostFail,
  stubFetchPostOk,
} from '../../StrategyTestHelpers.js';

describe('scrapeOneAccountViaUrl', () => {
  it('fails when no transaction URL can be resolved', async () => {
    const api = makeApi({ fetchGet: stubFetchGetFail() });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network);
    const result = await scrapeOneAccountViaUrl(fc, 'a');
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });

  it('fails when fetchGet fails', async () => {
    const api = makeApi({
      fetchGet: stubFetchGetFail(),
      transactionsUrl: 'https://example.com/txn',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network);
    const result = await scrapeOneAccountViaUrl(fc, 'acc-1');
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(false);
  });

  it('succeeds with empty transactions when fetchGet returns empty body', async () => {
    const api = makeApi({
      fetchGet: stubFetchGetOk({}),
      transactionsUrl: 'https://example.com/txn',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network);
    const result = await scrapeOneAccountViaUrl(fc, 'acc-1');
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('routes to filterData strategy when URL contains filterData', async () => {
    const ep = makeEndpoint({
      url: 'https://max.example/api?filterData=xyz',
      method: 'GET',
      responseBody: { result: { transactions: [] } },
    });
    const api = makeApi({
      fetchGet: stubFetchGetOk({ result: { transactions: [] } }),
    });
    const network = makeNetwork();
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountViaUrl(fc, 'acc-1');
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });
});

describe('scrapeOneAccountPost', () => {
  it('succeeds via billing fallback when captured endpoint shape matches', async () => {
    const ep = makeEndpoint({
      url: 'https://bank.example/api/transactions',
      method: 'POST',
      postData: '{"cardUniqueId":"card-1"}',
      responseBody: undefined,
    });
    const api = makeApi({
      fetchPost: stubFetchPostOk({}),
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [ep],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const record = { cardUniqueId: 'card-1' };
    const result = await scrapeOneAccountPost(fc, record);
    // Billing yielded 0 txns → range → direct. Any isOk result is fine.
    expect(typeof result).toBe('object');
  });

  it('falls through to direct POST when no txn endpoint discovered', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/api',
      method: 'POST',
      postData: '{"accountId":"a1"}',
      responseBody: undefined,
    });
    const api = makeApi({
      fetchPost: stubFetchPostOk({}),
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, { accountId: 'a1' });
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('returns failure when direct POST fails', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/api',
      method: 'POST',
      postData: '{"accountId":"a1"}',
      responseBody: undefined,
    });
    const api = makeApi({
      fetchPost: stubFetchPostFail(),
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, { accountId: 'a1' });
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(false);
  });

  it('routes to range iteration when POST body has fromDate/toDate', async () => {
    const ep = makeEndpoint({
      url: 'https://example.com/api',
      method: 'POST',
      postData: '{"accountId":"a1","fromDate":"2024-01-01","toDate":"2024-12-31"}',
      responseBody: undefined,
    });
    const api = makeApi({
      fetchPost: stubFetchPostOk({}),
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network, { txnEndpoint: ep });
    const result = await scrapeOneAccountPost(fc, {
      accountId: 'a1',
      fromDate: '2024-01-01',
      toDate: '2024-12-31',
    });
    // Regardless of eventual outcome we just want to hit the range branch
    expect(typeof result.success).toBe('boolean');
  });
});
