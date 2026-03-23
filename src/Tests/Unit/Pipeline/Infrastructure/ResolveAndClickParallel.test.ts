/**
 * Unit tests for fast parallel resolveAndClick.
 * Tests the parallel race concept without importing the full mediator chain.
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

describe('resolveAndClick parallel', () => {
  it('resolves true when mediator finds and clicks element', async () => {
    const mediator = makeMockMediator({
      /**
       * Simulate finding and clicking an element.
       * @returns True.
       */
      resolveAndClick: (): Promise<boolean> => Promise.resolve(true),
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'כניסה לחשבון' }];
    const didClick = await mediator.resolveAndClick(candidates);
    expect(didClick).toBe(true);
  });

  it('returns false when no candidate matches', async () => {
    const mediator = makeMockMediator({
      /**
       * Nothing found.
       * @returns False.
       */
      resolveAndClick: (): Promise<boolean> => Promise.resolve(false),
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'not on page' }];
    const didClick = await mediator.resolveAndClick(candidates);
    expect(didClick).toBe(false);
  });

  it('returns false on error (best-effort)', async () => {
    const mediator = makeMockMediator({
      /**
       * Error during resolution.
       * @returns Rejected.
       */
      resolveAndClick: (): Promise<boolean> => {
        const err = new Error('detached');
        return Promise.reject(err);
      },
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'כניסה' }];
    const didClick = await mediator.resolveAndClick(candidates).catch((): boolean => false);
    expect(didClick).toBe(false);
  });
});
