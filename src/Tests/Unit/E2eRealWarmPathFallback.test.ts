/**
 * Warm-path fallback — unit coverage for the cached-token retry.
 *
 * <p>Guards the failure that made PR #456's Pepper E2E-Real job go red on
 * 08-08 while the identical commit range passed hours earlier: the cached
 * long-term OTP token had expired, the harness still forced the warm path
 * because the cache file was non-empty, and the bank answered with an
 * opaque `graphql errors: Request failed with status code 500`. Nothing in
 * the diff changed — only the clock. These tests pin the self-healing
 * behaviour so an expired token can never again present as a regression.
 *
 * Fixtures are synthetic and carry zero PII.
 */

import { jest } from '@jest/globals';

import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';
import type { ITokenCacheHandle } from '../E2eReal/TokenCache.js';
import { scrapeWithWarmFallback } from '../E2eReal/WarmPathFallback.js';

const WARM_CREDS = { password: 'warm' } as unknown as ScraperCredentials;
const COLD_CREDS = { password: 'cold' } as unknown as ScraperCredentials;
const CACHED_TOKEN = 'stale-long-term-token';

const OK: IScraperScrapingResult = { success: true, accounts: [] };
const REJECTED: IScraperScrapingResult = {
  success: false,
  errorType: 'GENERIC',
  errorMessage: 'graphql errors: Request failed with status code 500',
} as unknown as IScraperScrapingResult;

/**
 * Build a logger stub capturing nothing — the helper only emits diagnostics.
 * @returns Logger double.
 */
function stubLog(): ScraperLogger {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return log as unknown as ScraperLogger;
}

/**
 * Build a cache handle whose invalidate() is observable.
 * @returns Cache double exposing the invalidate spy.
 */
function stubCache(): { cache: ITokenCacheHandle; invalidate: jest.Mock } {
  const invalidate = jest.fn(() => Promise.resolve(true));
  const cache = { enabled: true, invalidate } as unknown as ITokenCacheHandle;
  return { cache, invalidate };
}

/**
 * Build a scrape-attempt double that returns queued results in order.
 * @param queue - Results to hand out, oldest first.
 * @returns Attempt spy.
 */
function queuedAttempt(queue: IScraperScrapingResult[]): jest.Mock {
  return jest.fn(() => Promise.resolve(queue.shift() ?? OK));
}

/**
 * Build a cold-credential factory whose invocations are observable.
 * @returns Factory double.
 */
function stubColdFactory(): jest.Mock {
  return jest.fn(() => COLD_CREDS);
}

describe('scrapeWithWarmFallback', () => {
  it('keeps the warm result and leaves the cache intact when the token works', async () => {
    const { cache, invalidate } = stubCache();
    const buildCold = stubColdFactory();
    const attempt = jest.fn(() => Promise.resolve(OK));
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: buildCold,
      attempt,
      log: stubLog(),
    });

    expect(result).toBe(OK);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(WARM_CREDS);
    expect(invalidate).not.toHaveBeenCalled();
    // Lazy construction: no SMS-OTP retriever is built while the token holds.
    expect(buildCold).not.toHaveBeenCalled();
  });

  it('invalidates the rejected token and retries cold with SMS OTP', async () => {
    const { cache, invalidate } = stubCache();
    const buildCold = stubColdFactory();
    const attempt = queuedAttempt([REJECTED, OK]);
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: buildCold,
      attempt,
      log: stubLog(),
    });

    expect(result).toBe(OK);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenNthCalledWith(1, WARM_CREDS);
    expect(attempt).toHaveBeenNthCalledWith(2, COLD_CREDS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Built after the rejection, so the retry carries a fresh OTP
    // retriever instead of replaying the memoised code.
    expect(buildCold).toHaveBeenCalledTimes(1);
  });

  it('surfaces a cold-path failure without doubling the bank traffic', async () => {
    const { cache, invalidate } = stubCache();
    const buildCold = stubColdFactory();
    const attempt = jest.fn(() => Promise.resolve(REJECTED));
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken: '',
      warmCreds: WARM_CREDS,
      coldCreds: buildCold,
      attempt,
      log: stubLog(),
    });

    expect(result).toBe(REJECTED);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(COLD_CREDS);
    expect(invalidate).not.toHaveBeenCalled();
    expect(buildCold).toHaveBeenCalledTimes(1);
  });

  it('returns the cold retry failure when the fresh login also fails', async () => {
    const { cache, invalidate } = stubCache();
    const buildCold = stubColdFactory();
    const attempt = jest.fn(() => Promise.resolve(REJECTED));
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: buildCold,
      attempt,
      log: stubLog(),
    });

    expect(result).toBe(REJECTED);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(buildCold).toHaveBeenCalledTimes(1);
  });
});
