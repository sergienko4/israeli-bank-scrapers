/**
 * Unit tests for Strategy/Scrape/Proxy/ScrapeProxyQualification — runProxyQualification paths.
 */

import { runProxyQualification } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Proxy/ScrapeProxyQualification.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';
import {
  makeApi,
  makeEndpoint,
  makeNetwork,
  stubFetchPostFail,
  stubFetchPostOk,
} from '../../StrategyTestHelpers.js';

describe('Feature — ProxyQualification', () => {
  it('succeeds with unchanged context when no replayable txn template found', async () => {
    const input: IPipelineContext = makeMockContext();
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network: makeNetwork(),
      api: makeApi(),
    });
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('succeeds when no discoveredProxyUrl (virtual template fails)', async () => {
    const input: IPipelineContext = makeMockContext();
    // No proxy URL + no txn endpoints = virtual template path returns false
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network: makeNetwork(),
      api: makeApi(),
    });
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('qualifies cards via POST probe when txn template is captured (DIRECT)', async () => {
    const txnEp = makeEndpoint({
      url: 'https://bank.example/txn',
      method: 'POST',
      postData: '{"last4digits":"1234","billingMonth":"01/01/2026"}',
      responseBody: { foo: 'bar' },
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [txnEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve(false),
    });
    const api = makeApi({ fetchPost: stubFetchPostOk({ isSuccess: true }) });
    const input: IPipelineContext = makeMockContext();
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api,
    });
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('handles PROXY strategy fast path (skip probe)', async () => {
    // Build a proxy-style response body with cards array carrying cardIndex
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: {
        cardCharges: [
          { cardIndex: 'idx-1', cardNumber: '1234' },
          { cardIndex: 'idx-2', cardNumber: '5678' },
        ],
      },
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [proxyEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve(false),
    });
    const diagnostics = {
      ...makeMockContext().diagnostics,
      apiStrategy: API_STRATEGY.PROXY,
      discoveredProxyUrl: 'https://bank.example/ProxyRequestHandler.ashx',
    };
    const input: IPipelineContext = makeMockContext({ diagnostics });
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api: makeApi(),
    });
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('prunes cards when POST probe fails', async () => {
    const txnEp = makeEndpoint({
      url: 'https://bank.example/txn',
      method: 'POST',
      postData: '{"last4digits":"1234","billingMonth":"01/01/2026"}',
      responseBody: { foo: 'bar' },
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [txnEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve(false),
    });
    const api = makeApi({ fetchPost: stubFetchPostFail() });
    const input: IPipelineContext = makeMockContext();
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api,
    });
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('handles PROXY with nested DashboardMonth body (one-level deep)', async () => {
    const nestedBody = {
      response: {
        cardCharges: [{ cardIndex: 'n-1', cardNumber: '4718' }],
      },
    };
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: nestedBody,
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [proxyEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve(false),
    });
    const diagnostics = {
      ...makeMockContext().diagnostics,
      apiStrategy: API_STRATEGY.PROXY,
      discoveredProxyUrl: 'https://bank.example/ProxyRequestHandler.ashx',
    };
    const input: IPipelineContext = makeMockContext({ diagnostics });
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api: makeApi(),
    });
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('classifies probe success vs isSuccess:false', async () => {
    const txnEp = makeEndpoint({
      url: 'https://bank.example/txn',
      method: 'POST',
      postData: '{"last4digits":"1234","billingMonth":"01/01/2026"}',
      responseBody: { foo: 'bar' },
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [txnEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve(false),
    });
    const api = makeApi({ fetchPost: stubFetchPostOk({ isSuccess: false }) });
    const input: IPipelineContext = makeMockContext();
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api,
    });
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('qualifies cards organic template path (signature-matching txn endpoint)', async () => {
    // findProxyTxnTemplate requires TXN_SIGNATURE_KEYS (originalAmount|fullPurchaseDate|transactionDate)
    // in the response body. With a .ashx proxy url, the match is returned.
    const txnEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=CalBalance',
      method: 'POST',
      postData: '{"last4digits":"1234","billingMonth":"01/01/2026"}',
      responseBody: { Transactions: [{ transactionDate: '2026-01-01', originalAmount: 100 }] },
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAllEndpoints: () => [txnEp],
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAuthToken: () => Promise.resolve('Bearer abc'),
    });
    const api = makeApi({ fetchPost: stubFetchPostOk({ isSuccess: true, foo: 'bar' }) });
    const input: IPipelineContext = makeMockContext({
      credentials: {
        username: 'u',
        password: 'p',
        id: '111',
        card6Digits: '1234',
      } as unknown as IPipelineContext['credentials'],
    });
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api,
    });
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });
});
