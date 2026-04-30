/**
 * Unit tests for DashboardTrigger — UI + Proxy triggers.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  buildProxyDashboardUrl,
  triggerDashboardUi,
  triggerProxyDashboard,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardTrigger.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { fail as failFn, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger } from './TestHelpers.js';

/** Found race result for clickable WK element. */
const FOUND: IRaceResult = {
  found: true,
  locator: false,
  candidate: { kind: 'textContent', value: 'Transactions' },
  context: {} as unknown as IRaceResult['context'],
  index: 0,
  value: 'Transactions',
  identity: false,
};

/**
 * Build a mock fetch strategy that returns a canned result.
 * @param success - Whether the fetch should succeed.
 * @returns Mock fetch strategy.
 */
function makeFetchStrategy(success: boolean): IFetchStrategy {
  return {
    /**
     * GET returns success or failure based on flag.
     * @returns Succeed or fail procedure.
     */
    fetchGet: () => {
      const succeedResult1 = succeed({});
      if (success) return Promise.resolve(succeedResult1);
      const failFnResult2 = failFn(ScraperErrorTypes.Generic, 'fetch failed');
      return Promise.resolve(failFnResult2);
    },
    /**
     * POST — mirrors GET behavior.
     * @returns Succeed or fail procedure.
     */
    fetchPost: () => {
      const succeedResult3 = succeed({});
      if (success) return Promise.resolve(succeedResult3);
      const failFnResult4 = failFn(ScraperErrorTypes.Generic, 'fetch failed');
      return Promise.resolve(failFnResult4);
    },
  } as unknown as IFetchStrategy;
}

describe('buildProxyDashboardUrl', () => {
  it('builds URL with reqName + query defaults', () => {
    const url = buildProxyDashboardUrl('https://proxy.example.com/api', {});
    expect(url).toContain('reqName=');
    expect(url).toContain('?');
  });

  it('encodes extra params', () => {
    const url = buildProxyDashboardUrl('https://proxy.example.com/api', {
      billingDate: '2026-04-01',
    });
    expect(url).toContain('billingDate=2026-04-01');
  });

  it('URL-encodes special chars in values', () => {
    const url = buildProxyDashboardUrl('https://proxy.example.com/api', {
      x: 'a/b',
    });
    expect(url).toContain('x=a%2Fb');
  });
});

describe('triggerDashboardUi', () => {
  it('returns succeed(false) when no UI elements match', async () => {
    const mediator = makeMockMediator();
    const logger = makeFlushableLogger();
    const result = await triggerDashboardUi(mediator, logger);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
  });

  it('returns succeed(truthy) when transactions click hits traffic', async () => {
    let callCount = 0;
    const mediator: IElementMediator = makeMockMediator({
      /**
       * Return found on first call — triggers traffic wait.
       * @returns Succeed with FOUND.
       */
      resolveAndClick: () => {
        callCount += 1;
        const succeedResult6 = succeed(FOUND);
        if (callCount === 1) return Promise.resolve(succeedResult6);
        const succeedResult7 = succeed(FOUND);
        return Promise.resolve(succeedResult7);
      },
    });
    const logger = makeFlushableLogger();
    const result = await triggerDashboardUi(mediator, logger);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('clicks menu fallback when transactions does not match', async () => {
    let callCount = 0;
    const notFound = { ...FOUND, found: false, value: '' };
    const mediator: IElementMediator = makeMockMediator({
      /**
       * First call returns not-found (txn), second returns found (menu).
       * @returns Succeed procedure.
       */
      resolveAndClick: () => {
        callCount += 1;
        const succeedResult9 = succeed(notFound);
        if (callCount === 1) return Promise.resolve(succeedResult9);
        const succeedResult10 = succeed({ ...FOUND, value: 'Menu' });
        return Promise.resolve(succeedResult10);
      },
    });
    const logger = makeFlushableLogger();
    const result = await triggerDashboardUi(mediator, logger);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });

  it('logs traffic hit when waitForTraffic returns a hit', async () => {
    const mediator: IElementMediator = makeMockMediator({
      /**
       * Return found — triggers traffic wait.
       * @returns Succeed with FOUND.
       */
      resolveAndClick: () => {
        const okFound = succeed(FOUND);
        return Promise.resolve(okFound);
      },
    });
    // Mutate network.waitForTraffic to return a hit.
    /**
     * Test helper.
     *
     * @returns Result.
     */
    (
      mediator.network as unknown as {
        waitForTraffic: () => Promise<{ method: string; url: string }>;
      }
    ).waitForTraffic = (): Promise<{ method: string; url: string }> =>
      Promise.resolve({ method: 'GET', url: 'https://x/txns' });
    const logger = makeFlushableLogger();
    const result = await triggerDashboardUi(mediator, logger);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });
});

describe('triggerProxyDashboard', () => {
  it('returns succeed(false) when fetchGet fails', async () => {
    const mediator = makeMockMediator();
    const strategy = makeFetchStrategy(false);
    const logger = makeFlushableLogger();
    const result = await triggerProxyDashboard({
      mediator,
      strategy,
      proxyUrl: 'https://proxy.example.com',
      proxyParams: { dashboard: { billingDate: 'YYYY-MM-01' } },
      logger,
    });
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
  });

  it('returns succeed(true) when fetchGet succeeds', async () => {
    const mediator = makeMockMediator();
    const strategy = makeFetchStrategy(true);
    const logger = makeFlushableLogger();
    const result = await triggerProxyDashboard({
      mediator,
      strategy,
      proxyUrl: 'https://proxy.example.com',
      logger,
    });
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
    if (isOk(result)) expect(result.value).toBe(true);
  });

  it('logs traffic hit when network.waitForTraffic returns in proxy flow', async () => {
    const mediator = makeMockMediator();
    /**
     * Test helper.
     *
     * @returns Result.
     */
    (
      mediator.network as unknown as {
        waitForTraffic: () => Promise<{ method: string; url: string }>;
      }
    ).waitForTraffic = (): Promise<{ method: string; url: string }> =>
      Promise.resolve({ method: 'GET', url: 'https://api/txns?x=1' });
    const strategy = makeFetchStrategy(true);
    const logger = makeFlushableLogger();
    const result = await triggerProxyDashboard({
      mediator,
      strategy,
      proxyUrl: 'https://proxy.example.com',
      logger,
    });
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });
});
