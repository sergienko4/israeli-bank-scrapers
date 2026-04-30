/**
 * Branch recovery tests for GenericAutoScrapeStrategy.
 * Targets:
 *  - line 341: `if (!isOk(rawAccounts)) return rawAccounts` — discovered accounts
 *    endpoint exists but fetch fails → the failure propagates.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { genericAutoScrape } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeApi, makeEndpoint, makeNetwork, stubFetchPostFail } from '../StrategyTestHelpers.js';

describe('GenericAutoScrapeStrategy — branch recovery (line 341)', () => {
  it('propagates failure when discovered accounts endpoint fetch fails', async () => {
    // An endpoint is discovered via discoverAccountsEndpoint but it has NO
    // buffered response → loadDiscovered calls api.fetchPost, which fails.
    // discoverAndLoadAccounts returns the failure, and genericAutoScrape
    // returns early via `if (!isOk(rawAccounts)) return rawAccounts;`.
    const postEndpoint: IDiscoveredEndpoint = makeEndpoint({
      method: 'POST',
      url: 'https://bank.example.com/accounts',
      postData: '{"req":"list"}',
      responseBody: false as unknown as Record<string, unknown>,
    });
    const api = makeApi({ fetchPost: stubFetchPostFail() });
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverAccountsEndpoint: (): IDiscoveredEndpoint => postEndpoint,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverEndpointByContent: (): false => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: (): false => false,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverSpaUrl: (): false => false,
    });
    const mediator = {
      network,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.example.com',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      navigateTo: () => {
        const okResult = succeed(undefined);
        return Promise.resolve(okResult);
      },
    } as unknown as IElementMediator;
    const page = {
      /**
       * Frames helper.
       * @returns Result.
       */
      frames: (): unknown[] => [],
      /**
       * Evaluate helper.
       * @returns Result.
       */
      evaluate: (): Promise<object> => Promise.resolve({}),
    };
    const ctx: IPipelineContext = makeMockContext({
      api: some(api),
      mediator: some(mediator),
      browser: some({ page } as unknown as IBrowserState),
    });
    const result = await genericAutoScrape(ctx);
    const isOkFlag = isOk(result);
    expect(isOkFlag).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('post');
    }
  });
});
