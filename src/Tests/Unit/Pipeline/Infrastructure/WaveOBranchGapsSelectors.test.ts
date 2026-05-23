/**
 * Wave O — branch-gap tests split from main file (SelectorResolver).
 */

import type { Page } from 'playwright-core';

describe('SelectorResolver exports', () => {
  it('tryInContext returns empty string on empty candidates', async () => {
    const { tryInContext } =
      await import('../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js');
    const page = {
      /**
       * locator stub — returns no matches.
       * @returns Stub locator.
       */
      locator: (): object => ({
        /**
         * count returns 0.
         * @returns 0.
         */
        count: (): Promise<number> => Promise.resolve(0),
      }),
    } as unknown as Page;
    const result = await tryInContext(page, []);
    expect(result).toBe('');
  });

  it('tryInContext returns empty when all probes return empty (reduce passthrough)', async () => {
    const { tryInContext } =
      await import('../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js');
    // page where locator.count() returns 0 so candidates don't match
    const page = {
      /**
       * locator stub — returns 0.
       * @returns Stub.
       */
      locator: (): object => ({
        /**
         * count returns 0.
         * @returns 0.
         */
        count: (): Promise<number> => Promise.resolve(0),
        /**
         * first returns a stub.
         * @returns Stub.
         */
        first: (): object => ({
          /**
           * waitFor throws.
           * @returns Rejected.
           */
          waitFor: (): Promise<never> => Promise.reject(new Error('timeout')),
        }),
      }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'https://x',
    } as unknown as Page;
    const candidates = [
      { kind: 'css' as const, value: '#a' },
      { kind: 'css' as const, value: '#b' },
    ];
    const result = await tryInContext(page, candidates);
    expect(result).toBe('');
  });
});

// ── FormAnchor — scope branches ──────────────────────────
