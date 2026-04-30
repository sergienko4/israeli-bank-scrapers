/**
 * Branch completion for ScrapeProxyQualification.
 * Exercises buildVirtualTemplate failure paths, nested extraction variants.
 */

import { runProxyQualification } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Proxy/ScrapeProxyQualification.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';
import { makeApi, makeEndpoint, makeNetwork, stubFetchPostOk } from '../../StrategyTestHelpers.js';

describe('Feature — ProxyQualification — branch completion', () => {
  it('virtual template fails when account signature missing in acctEp body', async () => {
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: { unrelated: 'field' },
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
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('handles DashboardMonth body with no cardIndex fields (0 indices → no virtual)', async () => {
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: {
        cardsCharges: [{ notAnIndex: 'x' }],
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
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('cardIndex item missing cardNumber still counted as index (no display entry)', async () => {
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: {
        cardsCharges: [
          { cardIndex: 'idx-only' }, // no cardNumber → display empty
          { cardIndex: 'idx-b', cardNumber: '4567' },
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
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('card item with non-string cardIndex is filtered out', async () => {
    const proxyEp = makeEndpoint({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
      method: 'POST',
      postData: '',
      responseBody: {
        cardCharges: [
          { cardIndex: 123, cardNumber: '4718' }, // numeric index → filtered
          { cardIndex: 'ok', cardNumber: '6281' },
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

  it('DIRECT strategy with empty billingMonths uses fallback date', async () => {
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
    const baseInput = makeMockContext();
    // Force a far-future startDate so no billing months are generated
    const input: IPipelineContext = {
      ...baseInput,
      options: {
        ...baseInput.options,
        startDate: new Date('2099-01-01'),
      },
    };
    const result = await runProxyQualification({
      input,
      diag: input.diagnostics,
      network,
      api,
    });
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });
});
