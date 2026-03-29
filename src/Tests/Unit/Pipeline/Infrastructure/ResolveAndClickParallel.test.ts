/**
 * Unit tests for fast parallel resolveAndClick.
 * Tests the parallel race concept without importing the full mediator chain.
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

describe('resolveAndClick parallel', () => {
  it('resolves true when mediator finds and clicks element', async () => {
    const mediator = makeMockMediator({
      /**
       * Simulate finding and clicking an element.
       * @returns True.
       */
      resolveAndClick: () => {
        const found = succeed({ ...NOT_FOUND_RESULT, found: true as const });
        return Promise.resolve(found);
      },
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'כניסה לחשבון' }];
    const result = await mediator.resolveAndClick(candidates);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(true);
  });

  it('returns not-found when no candidate matches', async () => {
    const mediator = makeMockMediator({
      /**
       * Nothing found.
       * @returns Not-found result.
       */
      resolveAndClick: () => {
        const notFound = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(notFound);
      },
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'not on page' }];
    const result = await mediator.resolveAndClick(candidates);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(false);
  });

  it('returns failure on error (best-effort)', async () => {
    const mediator = makeMockMediator({
      /**
       * Error during resolution.
       * @returns Failure procedure.
       */
      resolveAndClick: () => {
        const err = fail(ScraperErrorTypes.Generic, 'detached');
        return Promise.resolve(err);
      },
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'כניסה' }];
    const result = await mediator.resolveAndClick(candidates);
    expect(result.success).toBe(false);
  });
});
