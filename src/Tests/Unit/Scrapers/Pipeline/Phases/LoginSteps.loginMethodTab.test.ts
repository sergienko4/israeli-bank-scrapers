/**
 * Unit tests for LoginSteps.tryClickLoginMethodTab.
 * Verifies generic tab detection — clicks when present, skips when absent.
 * All banks pass through this step; banks without a method-selection page skip it.
 */

import { tryClickLoginMethodTab } from '../../../../../Scrapers/Pipeline/Phases/GenericPreLoginSteps.js';
import { makeMockMediator } from '../MockPipelineFactories.js';

describe('tryClickLoginMethodTab', () => {
  it('returns true when mediator resolveAndClick succeeds', async () => {
    const mediator = makeMockMediator({
      /**
       * Simulate finding and clicking a tab.
       * @returns True — element found and clicked.
       */
      resolveAndClick: (): Promise<boolean> => Promise.resolve(true),
    });
    const didClick = await tryClickLoginMethodTab(mediator);
    expect(didClick).toBe(true);
  });

  it('returns false when mediator resolveAndClick finds nothing', async () => {
    const mediator = makeMockMediator({
      /**
       * Simulate not finding any tab.
       * @returns False — nothing found.
       */
      resolveAndClick: (): Promise<boolean> => Promise.resolve(false),
    });
    const didClick = await tryClickLoginMethodTab(mediator);
    expect(didClick).toBe(false);
  });

  it('returns false when mediator throws (detached frame)', async () => {
    const mediator = makeMockMediator({
      /**
       * Simulate detached frame error.
       * @returns Rejected.
       */
      resolveAndClick: (): Promise<boolean> => Promise.reject(new Error('detached')),
    });
    const didClick = await tryClickLoginMethodTab(mediator);
    expect(didClick).toBe(false);
  });
});
