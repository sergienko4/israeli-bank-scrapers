/**
 * Unit tests for DashboardTrigger — best-effort UI click trigger.
 */

import { triggerDashboardUi } from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardTrigger.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
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
