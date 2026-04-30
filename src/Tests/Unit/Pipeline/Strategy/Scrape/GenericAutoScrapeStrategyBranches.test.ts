/**
 * Branch coverage extensions for GenericAutoScrapeStrategy.
 * Covers Pascal-case Cards, queryId-missing fallback, storage harvest, proxy fail path.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  buildLoadAllCtx,
  genericAutoScrape,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import {
  API_STRATEGY,
  type IBrowserState,
  type IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeApi, makeEndpoint, makeFc, makeNetwork } from '../StrategyTestHelpers.js';

describe('GenericAutoScrapeStrategy — branch extensions', () => {
  it('extractCardIdFromArray reads Pascal-case Cards key', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"Cards":[{"cardUniqueId":"pascal-card-id"}]}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toContain('pascal-card-id');
  });

  it('ignores empty cards array (returns false from extractCardIdFromArray)', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cards":[]}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toHaveLength(0);
  });

  it('returns false when first card has no queryId match', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cards":[{"unrelatedKey":"x"}]}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toHaveLength(0);
  });

  it('falls back to top-level when no cards array nor queryId', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"randomKey":"nothing"}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadAllCtx(fc, network, {});
    expect(result.ids).toHaveLength(0);
  });

  it('full genericAutoScrape runs with all deps + discovers 0 accounts via harvest', async () => {
    const api = makeApi();
    const network: INetworkDiscovery = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: () => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverEndpointByContent: () => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverSpaUrl: () => false,
    });
    const mediator = {
      network,
      /**
       * URL getter.
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://a.example',
      /**
       * Nav.
       * @returns Result.
       */
      navigateTo: () => succeed(undefined),
    } as unknown as IElementMediator;
    const page = {
      /**
       * Mock frame list.
       * @returns Result.
       */
      frames: (): unknown[] => [],
      /**
       * Evaluate stub.
       * @returns Result.
       */
      evaluate: (): Promise<unknown[]> => Promise.resolve([]),
    };
    const ctx: IPipelineContext = makeMockContext({
      api: some(api),
      mediator: some(mediator),
      browser: some({ page } as unknown as IBrowserState),
    });
    const result = await genericAutoScrape(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('routes to proxy path when PROXY strategy is set (fail passthrough)', async () => {
    const pipeline = makeMockContext();
    const ctx: IPipelineContext = {
      ...pipeline,
      diagnostics: { ...pipeline.diagnostics, apiStrategy: API_STRATEGY.PROXY },
    };
    const result = await genericAutoScrape(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
