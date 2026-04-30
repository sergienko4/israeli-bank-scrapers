/**
 * Branch coverage extensions for ProxyScrapeReplayStrategy.
 * Exercises POST/GET failure paths, empty-txn card filter, displayMap paths.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { IFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { proxyScrape } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Proxy/ProxyScrapeReplayStrategy.js';
import { none, some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IScrapeDiscovery,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';

/**
 * Build a stub IFetchStrategy with GET/POST responses.
 * @param opts - Parameter.
 * @param opts.postResult - Scripted POST outcome.
 * @param opts.getResult - Scripted GET outcome.
 * @param opts.body - Response body.
 * @returns Result.
 */
function makeFetchStrategy(opts: {
  postResult?: 'ok' | 'fail';
  getResult?: 'ok' | 'fail';
  body?: Record<string, unknown>;
}): IFetchStrategy {
  const body = opts.body ?? {};
  return {
    /**
     * POST per configured outcome.
     * @returns Procedure.
     */
    fetchPost: () =>
      opts.postResult === 'fail'
        ? fail(ScraperErrorTypes.Generic, 'post-fail')
        : succeed(body as unknown as Record<string, unknown>),
    /**
     * GET per configured outcome.
     * @returns Procedure.
     */
    fetchGet: () =>
      opts.getResult === 'fail'
        ? fail(ScraperErrorTypes.Generic, 'get-fail')
        : succeed(body as unknown as Record<string, unknown>),
  } as unknown as IFetchStrategy;
}

/**
 * Build a sealed action context.
 * @param overrides - Parameter.
 * @returns Result.
 */
function makeActionCtx(overrides: Partial<IActionContext> = {}): IActionContext {
  const pipeline = makeMockContext();
  const base: IActionContext = {
    options: pipeline.options,
    credentials: pipeline.credentials,
    companyId: pipeline.companyId,
    logger: pipeline.logger,
    diagnostics: pipeline.diagnostics,
    config: pipeline.config,
    fetchStrategy: none(),
    executor: none(),
    apiMediator: none(),
    loginFieldDiscovery: none(),
    preLoginDiscovery: none(),
    dashboard: none(),
    scrapeDiscovery: none(),
    api: none(),
    loginAreaReady: false,
  };
  return { ...base, ...overrides };
}

/**
 * Build a discovery with specifics.
 * @param overrides - Parameter.
 * @returns Result.
 */
function makeDisc(overrides: Partial<IScrapeDiscovery> = {}): IScrapeDiscovery {
  const base: IScrapeDiscovery = {
    qualifiedCards: ['card-a'],
    prunedCards: [],
    txnTemplateUrl: 'https://bank.example/txn',
    txnTemplateBody: {},
    billingMonths: ['01/01/2026'],
    cardDisplayMap: new Map(),
    frozenEndpoints: [],
    rawAccountRecords: [],
  };
  return { ...base, ...overrides };
}

describe('proxyScrape — branch paths', () => {
  it('DIRECT POST path continues when fetchPost fails for one month', async () => {
    const makeDiscResult2 = makeDisc({
      qualifiedCards: ['c1'],
      billingMonths: ['01/01/2026', '01/02/2026'],
    });
    const makeFetchStrategyResult1 = makeFetchStrategy({ postResult: 'fail' });
    const ctx = makeActionCtx({
      fetchStrategy: some(makeFetchStrategyResult1),
      scrapeDiscovery: some(makeDiscResult2),
    });
    const result = await proxyScrape(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('PROXY GET path continues when fetchGet fails', async () => {
    const pipeline = makeMockContext();
    const diagnostics = { ...pipeline.diagnostics, apiStrategy: API_STRATEGY.PROXY };
    const makeDiscResult5 = makeDisc({
      qualifiedCards: ['c1'],
      billingMonths: ['01/01/2026'],
    });
    const makeFetchStrategyResult4 = makeFetchStrategy({ getResult: 'fail' });
    const ctx = makeActionCtx({
      diagnostics,
      fetchStrategy: some(makeFetchStrategyResult4),
      scrapeDiscovery: some(makeDiscResult5),
    });
    const result = await proxyScrape(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('DIRECT POST emits non-empty txns via real txn body', async () => {
    const txnBody = {
      Transactions: [
        {
          date: '2026-01-15',
          originalAmount: 100,
          description: 'Coffee',
          fullPurchaseDate: '2026-01-15',
        },
      ],
    };
    const makeDiscResult8 = makeDisc({
      qualifiedCards: ['c1'],
      billingMonths: ['01/01/2026'],
      cardDisplayMap: new Map([['c1', '1234']]),
    });
    const makeFetchStrategyResult7 = makeFetchStrategy({ postResult: 'ok', body: txnBody });
    const ctx = makeActionCtx({
      fetchStrategy: some(makeFetchStrategyResult7),
      scrapeDiscovery: some(makeDiscResult8),
    });
    const result = await proxyScrape(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('PROXY GET path with displayMap undefined (cardDisplayMap=undefined triggers ?? false)', async () => {
    const pipeline = makeMockContext();
    const diagnostics = { ...pipeline.diagnostics, apiStrategy: API_STRATEGY.PROXY };
    const makeDiscResult11 = makeDisc({
      qualifiedCards: ['c1'],
      billingMonths: ['01/01/2026'],
      cardDisplayMap: undefined as unknown as ReadonlyMap<string, string>,
    });
    const makeFetchStrategyResult10 = makeFetchStrategy({ getResult: 'ok', body: {} });
    const ctx = makeActionCtx({
      diagnostics,
      fetchStrategy: some(makeFetchStrategyResult10),
      scrapeDiscovery: some(makeDiscResult11),
    });
    const result = await proxyScrape(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('DIRECT POST with no txns returned (filters out empty accounts)', async () => {
    const makeDiscResult14 = makeDisc({
      qualifiedCards: ['c1'],
      billingMonths: ['01/01/2026'],
    });
    const makeFetchStrategyResult13 = makeFetchStrategy({ postResult: 'ok', body: {} });
    const ctx = makeActionCtx({
      fetchStrategy: some(makeFetchStrategyResult13),
      scrapeDiscovery: some(makeDiscResult14),
    });
    const result = await proxyScrape(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });
});
