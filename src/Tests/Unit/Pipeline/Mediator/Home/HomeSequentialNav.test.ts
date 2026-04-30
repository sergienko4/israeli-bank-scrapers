/**
 * Unit tests for HomeSequentialNav — executeSequentialClick.
 */

import type { IActionMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { executeSequentialClick } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeSequentialNav.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOG: ScraperLogger = {
  /**
   * Test helper.
   * @returns Result.
   */
  debug: (): boolean => true,
  /**
   * Test helper.
   * @returns Result.
   */
  trace: (): boolean => true,
  /**
   * Test helper.
   * @returns Result.
   */
  info: (): boolean => true,
  /**
   * Test helper.
   * @returns Result.
   */
  warn: (): boolean => true,
  /**
   * Test helper.
   * @returns Result.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build an IActionMediator stub whose clickElement resolves or rejects.
 * @param clickOk - Whether clickElement resolves.
 * @returns Mock executor.
 */
function makeExecutor(clickOk: boolean): IActionMediator {
  return {
    /**
     * clickElement.
     * @returns Scripted true or rejection.
     */
    clickElement: (): Promise<true> => {
      if (clickOk) return Promise.resolve(true);
      return Promise.reject(new Error('click fail'));
    },
    /**
     * waitForURL.
     * @returns Succeed false.
     */
    waitForURL: () => {
      const succeeded = succeed(false);
      return Promise.resolve(succeeded);
    },
    /**
     * waitForNetworkIdle.
     * @returns Succeed.
     */
    waitForNetworkIdle: () => {
      const succeeded = succeed(undefined);
      return Promise.resolve(succeeded);
    },
  } as unknown as IActionMediator;
}

/**
 * Build a discovery object with the given menu candidates.
 * @param values - Menu candidate values.
 * @returns IHomeDiscovery.
 */
function makeDiscovery(values: string[]): IHomeDiscovery {
  return {
    strategy: NAV_STRATEGY.SEQUENTIAL,
    triggerText: 'Menu',
    menuCandidates: values.map((v): { kind: 'textContent'; value: string } => ({
      kind: 'textContent',
      value: v,
    })),
    triggerTarget: false,
  };
}

describe('executeSequentialClick', () => {
  it('returns false when discovery has no menu candidates', async () => {
    const executor = makeExecutor(true);
    const discovery = makeDiscovery([]);
    const isOk = await executeSequentialClick(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });

  it('returns true when a menu candidate click succeeds', async () => {
    const executor = makeExecutor(true);
    const discovery = makeDiscovery(['Personal Account']);
    const isOk = await executeSequentialClick(executor, discovery, LOG);
    expect(isOk).toBe(true);
  }, 10000);

  it('returns false when all menu candidates fail to click', async () => {
    const executor = makeExecutor(false);
    const discovery = makeDiscovery(['A']);
    const isOk = await executeSequentialClick(executor, discovery, LOG);
    expect(isOk).toBe(false);
  }, 10000);

  it('short-circuits after first match (reduceCandidate line 63: if (found) return true)', async () => {
    // First candidate clicks OK — second should short-circuit via `found` guard.
    let clickCount = 0;
    const executor = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      clickElement: (): Promise<true> => {
        clickCount += 1;
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: () => {
        const succeeded = succeed(false);
        return Promise.resolve(succeeded);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: () => {
        const succeeded = succeed(undefined);
        return Promise.resolve(succeeded);
      },
    } as unknown as IActionMediator;
    const discovery = makeDiscovery(['First', 'Second', 'Third']);
    const isOk = await executeSequentialClick(executor, discovery, LOG);
    expect(isOk).toBe(true);
    // Only the first candidate was attempted — reduce returns early on found.
    expect(clickCount).toBe(1);
  }, 10000);
});
