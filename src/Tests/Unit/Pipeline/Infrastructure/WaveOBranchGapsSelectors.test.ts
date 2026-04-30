/**
 * Wave O — branch-gap tests split from main file (SelectorResolver +
 * MonthlyFetchLoop).
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

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

// ── MonthlyFetchLoop — applyRateLimit branches ───────────

describe('MonthlyFetchLoop scrapeAllMonths', () => {
  it('handles empty month list', async () => {
    const { scrapeAllMonths } =
      await import('../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthlyFetchLoop.js');
    const ctx = makeMockContext();
    const config = {
      rateLimitMs: 0, // triggers line 69 delayMs <= 0 branch
      /**
       * Get month transactions stub (unused with empty months).
       * @returns Empty accounts.
       */
      getMonthTransactions: (): Promise<ReturnType<typeof succeed<readonly never[]>>> =>
        Promise.resolve(succeed([]) as ReturnType<typeof succeed<readonly never[]>>),
    };
    const result = await scrapeAllMonths({ config, ctx, months: [] }, 0);
    expect(result.accounts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('scrapes a single month when provided (rateLimitMs=0 branch)', async () => {
    const [{ scrapeAllMonths }, moment] = await Promise.all([
      import('../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthlyFetchLoop.js'),
      import('moment'),
    ]);
    const ctx = makeMockContext();
    const config = {
      rateLimitMs: 0,
      /**
       * Return 0 accounts for the single month.
       * @returns Empty accounts.
       */
      getMonthTransactions: (): Promise<ReturnType<typeof succeed<readonly never[]>>> =>
        Promise.resolve(succeed([]) as ReturnType<typeof succeed<readonly never[]>>),
    };
    const months = [moment.default('2026-01-01')];
    const result = await scrapeAllMonths({ config, ctx, months }, 0);
    expect(result.accounts).toEqual([]);
  });

  it('applies rate limit with no browser (line 70 branch)', async () => {
    const [{ scrapeAllMonths }, moment] = await Promise.all([
      import('../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthlyFetchLoop.js'),
      import('moment'),
    ]);
    const ctx = makeMockContext();
    const config = {
      rateLimitMs: 1, // > 0, so rate limit runs
      /**
       * Get month transactions stub.
       * @returns Empty accounts.
       */
      getMonthTransactions: (): Promise<ReturnType<typeof succeed<readonly never[]>>> =>
        Promise.resolve(succeed([]) as ReturnType<typeof succeed<readonly never[]>>),
    };
    const months = [moment.default('2026-01-01'), moment.default('2026-02-01')];
    const result = await scrapeAllMonths({ config, ctx, months }, 0);
    expect(result.accounts).toEqual([]);
  });

  it('collects warnings when fetch fails', async () => {
    const [{ scrapeAllMonths }, moment] = await Promise.all([
      import('../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthlyFetchLoop.js'),
      import('moment'),
    ]);
    const ctx = makeMockContext();
    const config = {
      rateLimitMs: 0,
      /**
       * Return failure for the month.
       * @returns Rejection.
       */
      getMonthTransactions: (): Promise<ReturnType<typeof fail>> => {
        const failResult = fail(ScraperErrorTypes.Generic, 'month fail');
        return Promise.resolve(failResult);
      },
    };
    const months = [moment.default('2026-02-01')];
    const result = await scrapeAllMonths({ config, ctx, months }, 0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ── FormAnchor — scope branches ──────────────────────────
