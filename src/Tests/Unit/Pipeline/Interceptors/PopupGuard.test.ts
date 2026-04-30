/**
 * Unit tests for Interceptors/PopupGuard — isEntryAlreadyVisible probe.
 */

import { isEntryAlreadyVisible } from '../../../../Scrapers/Pipeline/Interceptors/PopupGuard.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Build a stub mediator with configurable resolveVisible outcome.
 * @param outcome - Outcome object or throw.
 * @param shouldThrow - Parameter.
 * @returns Stub element mediator.
 */
function makeMediator(outcome: unknown, shouldThrow = false): IElementMediator {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    resolveVisible: async (): Promise<unknown> => {
      await Promise.resolve();
      if (shouldThrow) throw new TestError('probe failed');
      return outcome;
    },
  } as unknown as IElementMediator;
}

describe('isEntryAlreadyVisible', () => {
  it('returns true when probe returns found=true', async () => {
    const mediator = makeMediator({ found: true, value: 'login' });
    const isVisible = await isEntryAlreadyVisible(mediator);
    expect(isVisible).toBe(true);
  });

  it('returns false when probe returns found=false', async () => {
    const mediator = makeMediator({ found: false });
    expect(await isEntryAlreadyVisible(mediator)).toBe(false);
  });

  it('returns false when probe result is falsy', async () => {
    const mediator = makeMediator(false);
    expect(await isEntryAlreadyVisible(mediator)).toBe(false);
  });

  it('returns false when probe throws', async () => {
    const mediator = makeMediator(null, true);
    expect(await isEntryAlreadyVisible(mediator)).toBe(false);
  });
});
