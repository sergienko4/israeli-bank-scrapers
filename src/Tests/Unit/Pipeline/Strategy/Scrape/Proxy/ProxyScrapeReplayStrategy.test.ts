/**
 * Unit tests for Proxy/ProxyScrapeReplayStrategy — template discovery + strategy gate.
 */

import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import {
  findProxyAccountTemplate,
  findProxyTxnTemplate,
  hasProxyStrategy,
  proxyScrape,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Proxy/ProxyScrapeReplayStrategy.js';
import { none, some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IDiagnosticsState,
  IScrapeDiscovery,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';

/**
 * Build a minimal endpoint stub.
 * @param override - Fields to override.
 * @returns Stub endpoint.
 */
function makeEp(override: Partial<IDiscoveredEndpoint> = {}): IDiscoveredEndpoint {
  const base = { url: 'u', method: 'GET', postData: '', responseBody: {} };
  return { ...base, ...override } as unknown as IDiscoveredEndpoint;
}

/**
 * Build a stub fetch strategy.
 * @param body - Response body to always return.
 * @returns IFetchStrategy stub.
 */
function makeStubFetchStrategy(body: Record<string, unknown>): IFetchStrategy {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    fetchPost: () => succeed(body),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    fetchGet: () => succeed(body),
  } as unknown as IFetchStrategy;
}

/**
 * Build a minimal sealed action context.
 * @param overrides - Partial context overrides.
 * @returns Stub IActionContext.
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
 * Build a minimal IScrapeDiscovery.
 * @param overrides - Partial overrides.
 * @returns IScrapeDiscovery.
 */
function makeDiscovery(overrides: Partial<IScrapeDiscovery> = {}): IScrapeDiscovery {
  const base: IScrapeDiscovery = {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: 'https://bank.example/txn',
    txnTemplateBody: {},
    billingMonths: [],
    cardDisplayMap: new Map(),
    frozenEndpoints: [],
    rawAccountRecords: [],
  };
  return { ...base, ...overrides };
}

describe('hasProxyStrategy', () => {
  it('returns true when diagnostics.apiStrategy is PROXY', () => {
    const diagnostics = { apiStrategy: API_STRATEGY.PROXY } as unknown as IDiagnosticsState;
    const isProxy = hasProxyStrategy({ diagnostics });
    expect(isProxy).toBe(true);
  });

  it('returns false when apiStrategy is DIRECT', () => {
    const diagnostics = { apiStrategy: API_STRATEGY.DIRECT } as unknown as IDiagnosticsState;
    const hasProxyStrategyResult1 = hasProxyStrategy({ diagnostics });
    expect(hasProxyStrategyResult1).toBe(false);
  });

  it('returns false when apiStrategy is undefined', () => {
    const diagnostics = {} as IDiagnosticsState;
    const hasProxyStrategyResult2 = hasProxyStrategy({ diagnostics });
    expect(hasProxyStrategyResult2).toBe(false);
  });
});

describe('findProxyAccountTemplate', () => {
  it('returns false when no endpoints match the account signature', () => {
    const eps = [makeEp({ responseBody: { foo: 'bar' } })];
    const findProxyAccountTemplateResult3 = findProxyAccountTemplate(eps);
    expect(findProxyAccountTemplateResult3).toBe(false);
  });

  it('returns false for empty endpoint list', () => {
    const findProxyAccountTemplateResult4 = findProxyAccountTemplate([]);
    expect(findProxyAccountTemplateResult4).toBe(false);
  });
});

describe('findProxyTxnTemplate', () => {
  it('returns false when no endpoints match the txn signature', () => {
    const eps = [makeEp({ responseBody: { foo: 'bar' } })];
    const findProxyTxnTemplateResult5 = findProxyTxnTemplate(eps);
    expect(findProxyTxnTemplateResult5).toBe(false);
  });

  it('returns false for empty endpoint list', () => {
    const findProxyTxnTemplateResult6 = findProxyTxnTemplate([]);
    expect(findProxyTxnTemplateResult6).toBe(false);
  });
});

describe('findProxyAccountTemplate (positive match)', () => {
  it('matches endpoint with account signature keys in responseBody', () => {
    const eps = [
      makeEp({
        url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=DashboardMonth',
        responseBody: { result: { cardsCharges: [{ cardIndex: 'a', cardNumber: '1234' }] } },
      }),
    ];
    const match = findProxyAccountTemplate(eps);
    expect(match).not.toBe(false);
  });
});

describe('proxyScrape', () => {
  it('succeeds unchanged when fetchStrategy is missing', async () => {
    const ctx = makeActionCtx({ fetchStrategy: none() });
    const result = await proxyScrape(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('succeeds unchanged when scrapeDiscovery is missing', async () => {
    const makeStubFetchStrategyResult8 = makeStubFetchStrategy({});
    const ctx = makeActionCtx({
      fetchStrategy: some(makeStubFetchStrategyResult8),
      scrapeDiscovery: none(),
    });
    const result = await proxyScrape(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('succeeds unchanged when qualifiedCards is empty', async () => {
    const makeDiscoveryResult11 = makeDiscovery({ qualifiedCards: [] });
    const makeStubFetchStrategyResult10 = makeStubFetchStrategy({});
    const ctx = makeActionCtx({
      fetchStrategy: some(makeStubFetchStrategyResult10),
      scrapeDiscovery: some(makeDiscoveryResult11),
    });
    const result = await proxyScrape(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('runs scrape-per-card POST path with DIRECT strategy and 0 billing months', async () => {
    const makeDiscoveryResult14 = makeDiscovery({ qualifiedCards: ['card-1'], billingMonths: [] });
    const makeStubFetchStrategyResult13 = makeStubFetchStrategy({});
    const ctx = makeActionCtx({
      fetchStrategy: some(makeStubFetchStrategyResult13),
      scrapeDiscovery: some(makeDiscoveryResult14),
    });
    const result = await proxyScrape(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });

  it('runs month-first GET path with PROXY strategy', async () => {
    const pipeline = makeMockContext();
    const diagnostics = { ...pipeline.diagnostics, apiStrategy: API_STRATEGY.PROXY };
    const makeDiscoveryResult17 = makeDiscovery({
      qualifiedCards: ['card-1'],
      billingMonths: ['01/01/2026'],
    });
    const makeStubFetchStrategyResult16 = makeStubFetchStrategy({ response: {} });
    const ctx = makeActionCtx({
      diagnostics,
      fetchStrategy: some(makeStubFetchStrategyResult16),
      scrapeDiscovery: some(makeDiscoveryResult17),
    });
    const result = await proxyScrape(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
  });

  it('runs DIRECT POST path with qualified cards + a billing month (replayOneMonth)', async () => {
    const makeDiscoveryResult20 = makeDiscovery({
      qualifiedCards: ['card-1', 'card-2'],
      billingMonths: ['01/01/2026'],
    });
    const makeStubFetchStrategyResult19 = makeStubFetchStrategy({ Transactions: [] });
    const ctx = makeActionCtx({
      fetchStrategy: some(makeStubFetchStrategyResult19),
      scrapeDiscovery: some(makeDiscoveryResult20),
    });
    const result = await proxyScrape(ctx);
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(true);
  });
});

describe('findProxyTxnTemplate — replayable txn endpoint path', () => {
  it('returns the latest endpoint containing billingMonth + txn signature (replayable)', () => {
    const ep1 = makeEp({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=CalBalance',
      method: 'POST',
      postData: '{"last4digits":"1234","billingMonth":"01/01/2026"}',
      responseBody: { transactions: [{ transactionDate: '2026-01-01', amount: 1 }] },
    });
    const ep2 = makeEp({
      url: 'https://bank.example/ProxyRequestHandler.ashx?reqName=CalBalance',
      method: 'POST',
      postData: '{"last4digits":"5678","billingMonth":"01/02/2026"}',
      responseBody: { Transactions: [{ originalAmount: 2, fullPurchaseDate: '2026-02-01' }] },
    });
    const match = findProxyTxnTemplate([ep1, ep2]);
    expect(match).not.toBe(false);
  });
});
