/**
 * Unit tests for Strategy/Scrape/GenericAutoScrapeStrategy — dispatch + SPA pivot.
 * Split from GenericAutoScrapeStrategy.test.ts to honor max-lines=300.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  genericAutoScrape,
  pivotToSpaIfNeeded,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeApi, makeEndpoint, makeNetwork } from '../StrategyTestHelpers.js';

describe('pivotToSpaIfNeeded', () => {
  /**
   * Build stub IElementMediator with URL + navigate.
   * @param url - Current URL.
   * @returns Stub mediator.
   */
  function makeMediator(url: string): IElementMediator {
    return {
      /**
       * Current URL stub.
       * @returns Configured URL.
       */
      getCurrentUrl: (): string => url,
      /**
       * NavigateTo stub.
       * @returns Success procedure.
       */
      navigateTo: () => succeed(undefined),
    } as unknown as IElementMediator;
  }

  it('succeeds false when no SPA URL', async () => {
    const mediator = makeMediator('https://a.example');
    const network = makeNetwork({
      /**
       * No SPA.
       * @returns Always false.
       */
      discoverSpaUrl: () => false,
    });
    const result = await pivotToSpaIfNeeded(mediator, network);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('succeeds false when current origin already matches SPA origin', async () => {
    const mediator = makeMediator('https://a.example/p');
    const network = makeNetwork({
      /**
       * SPA URL stub.
       * @returns SPA base URL.
       */
      discoverSpaUrl: () => 'https://a.example/',
    });
    const result = await pivotToSpaIfNeeded(mediator, network);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
  });

  it('skips pivot when current origin hosts txn endpoint', async () => {
    const mediator = makeMediator('https://a.example/p');
    const txnEp = makeEndpoint({ url: 'https://a.example/api/txn' });
    const network = makeNetwork({
      /**
       * SPA URL stub (different origin).
       * @returns SPA base URL.
       */
      discoverSpaUrl: () => 'https://b.example/',
      /**
       * Txn endpoint stub.
       * @returns Configured endpoint.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const result = await pivotToSpaIfNeeded(mediator, network);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
  });

  it("navigates when origins differ and current doesn't host txn endpoint", async () => {
    const mediator = makeMediator('https://a.example/p');
    const network = makeNetwork({
      /**
       * SPA URL stub (different origin).
       * @returns SPA base URL.
       */
      discoverSpaUrl: () => 'https://b.example/',
      /**
       * Txn endpoint missing.
       * @returns False.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const result = await pivotToSpaIfNeeded(mediator, network);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
    if (isOk(result)) expect(result.value).toBe(true);
  });
});

describe('genericAutoScrape', () => {
  it('returns ctx unchanged when api is missing', async () => {
    const ctx: IPipelineContext = makeMockContext({
      api: none(),
      mediator: none(),
      browser: none(),
    });
    const result = await genericAutoScrape(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('returns ctx unchanged when mediator is missing', async () => {
    const api = makeApi();
    const ctx: IPipelineContext = makeMockContext({
      api: some(api),
      mediator: none(),
      browser: none(),
    });
    const result = await genericAutoScrape(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });

  it('returns ctx unchanged when browser is missing', async () => {
    const api = makeApi();
    const network = makeNetwork();
    const mediator = {
      network,
      /**
       * Current URL stub.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://a.example',
      /**
       * NavigateTo stub.
       * @returns Success procedure.
       */
      navigateTo: () => succeed(undefined),
    } as unknown as IElementMediator;
    const ctx: IPipelineContext = makeMockContext({
      api: some(api),
      mediator: some(mediator),
      browser: none(),
    });
    const result = await genericAutoScrape(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
  });
});

describe('genericAutoScrape — partial coverage on full path', () => {
  it('returns ctx when full deps present but discovery is empty', async () => {
    const api = makeApi();
    const network: INetworkDiscovery = makeNetwork({
      /**
       * Accounts endpoint missing.
       * @returns False.
       */
      discoverAccountsEndpoint: () => false,
      /**
       * Endpoint-by-content missing.
       * @returns False.
       */
      discoverEndpointByContent: () => false,
      /**
       * Txn endpoint missing.
       * @returns False.
       */
      discoverTransactionsEndpoint: () => false,
      /**
       * SPA URL missing.
       * @returns False.
       */
      discoverSpaUrl: () => false,
    });
    const mediator = {
      network,
      /**
       * Current URL stub.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://a.example',
      /**
       * NavigateTo stub.
       * @returns Success procedure.
       */
      navigateTo: () => succeed(undefined),
    } as unknown as IElementMediator;
    const browser = {
      page: {
        /**
         * Evaluate stub.
         * @returns Empty array.
         */
        evaluate: () => [],
        /**
         * Frames stub.
         * @returns Empty array.
         */
        frames: () => [],
      },
    } as unknown as IBrowserState;
    const ctx: IPipelineContext = makeMockContext({
      api: some(api),
      mediator: some(mediator),
      browser: some(browser),
    });
    const result = await genericAutoScrape(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });
});
