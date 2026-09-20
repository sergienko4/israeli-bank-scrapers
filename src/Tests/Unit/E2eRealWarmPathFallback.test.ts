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
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import type { ILoginWitness } from '../E2eReal/LoginWitness.js';
import type { IOtpBudget, OtpRetriever } from '../E2eReal/OtpBudget.js';
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
 * A failure carrying the bank's auth-rejection marker.
 *
 * <p>The retry layer answers this by attempting a refresh — a cold login that
 * may cost a message — and, when the refresh fails, hands the original
 * rejection back unchanged. So this message is the only evidence the harness
 * gets that a mid-scrape login may have been attempted.
 */
const AUTH_REJECTED: IScraperScrapingResult = {
  success: false,
  errorType: 'GENERIC',
  errorMessage: 'request failed 401: unauthorized',
} as unknown as IScraperScrapingResult;

/**
 * Build a logger that records every warning it is given.
 * @param sink - Array receiving the warning messages, in order.
 * @returns Logger double.
 */
function recordingLog(sink: string[]): ScraperLogger {
  /**
   * Record a warning message.
   * @param _meta - Structured metadata, ignored here.
   * @param msg - Human-readable message.
   * @returns true, per the house ack contract.
   */
  function warn(_meta: unknown, msg: string): true {
    sink.push(msg);
    return true;
  }
  const log = { info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() };
  return log as unknown as ScraperLogger;
}

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

/**
 * Build a budget reporting a fixed number of messages already sent.
 * @param messages - Messages the run has cost so far.
 * @returns Budget double.
 */
function stubBudget(messages: number): IOtpBudget {
  /**
   * Report the fixed spend.
   * @returns The configured count.
   */
  function spent(): number {
    return messages;
  }
  /**
   * Pass the retriever through untouched — metering is tested separately.
   * @param retriever - Retriever to wrap.
   * @returns The same retriever.
   */
  function meter(retriever: OtpRetriever): OtpRetriever {
    return retriever;
  }
  return { meter, spent };
}

/**
 * Build a witness reporting a fixed observed login outcome.
 * @param token - Long-term token the pipeline reported, '' when no login ran.
 * @returns Witness double.
 */
function stubWitness(token: string): ILoginWitness {
  /**
   * Report the fixed token.
   * @returns The configured token.
   */
  function lastToken(): string {
    return token;
  }
  /**
   * Accept a callback payload without recording it — fixed by construction.
   * @returns Resolved promise.
   */
  function writer(): Promise<void> {
    return Promise.resolve();
  }
  return { writer, lastToken };
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
      otpBudget: stubBudget(0),
      loginWitness: stubWitness(CACHED_TOKEN),
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
      otpBudget: stubBudget(0),
      loginWitness: stubWitness(CACHED_TOKEN),
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
      otpBudget: stubBudget(0),
      loginWitness: stubWitness(CACHED_TOKEN),
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
      otpBudget: stubBudget(0),
      loginWitness: stubWitness(CACHED_TOKEN),
    });

    expect(result).toBe(REJECTED);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(buildCold).toHaveBeenCalledTimes(1);
  });
});

describe('scrapeWithWarmFallback — one SMS per run', () => {
  it('refuses a second SMS when the warm attempt already sent one', async () => {
    const { cache } = stubCache();
    const buildCold = stubColdFactory();
    const attempt = queuedAttempt([REJECTED, OK]);
    const result = await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: buildCold,
      attempt,
      log: stubLog(),
      loginWitness: stubWitness(CACHED_TOKEN),
      otpBudget: stubBudget(1),
    });

    expect(result).toBe(REJECTED);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(buildCold).not.toHaveBeenCalled();
  });

  it('keeps the token the spent login just minted', async () => {
    const { cache, invalidate: notCalled } = stubCache();
    const attempt = queuedAttempt([REJECTED, OK]);
    await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: stubColdFactory(),
      attempt,
      log: stubLog(),
      loginWitness: stubWitness(CACHED_TOKEN),
      otpBudget: stubBudget(1),
    });

    expect(notCalled).not.toHaveBeenCalled();
  });

  it('says why it stopped instead of failing silently', async () => {
    const { cache } = stubCache();
    const messages: string[] = [];
    const log = recordingLog(messages);
    const attempt = queuedAttempt([REJECTED, OK]);
    await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: stubColdFactory(),
      attempt,
      log,
      otpBudget: stubBudget(1),
      loginWitness: stubWitness(CACHED_TOKEN),
    });

    const joined = messages.join(' ');
    expect(joined).toContain('refusing a second login');
  });

  it('still retries when the warm attempt cost no message', async () => {
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
      loginWitness: stubWitness(CACHED_TOKEN),
      otpBudget: stubBudget(0),
    });

    expect(result).toBe(OK);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('leaves the cold path alone whatever the budget says', async () => {
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
      otpBudget: stubBudget(1),
      loginWitness: stubWitness(''),
    });

    expect(result).toBe(REJECTED);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('scrapeWithWarmFallback — proving the first attempt spent nothing', () => {
  /**
   * Run the fallback against a rejected warm attempt.
   * @param witness - Observed login outcome for attempt 1.
   * @param failed - The warm-path failure to surface.
   * @returns The attempt spy, for call-count assertions.
   */
  async function runRejectedWarm(
    witness: ILoginWitness,
    failed: IScraperScrapingResult,
  ): Promise<jest.Mock> {
    const { cache } = stubCache();
    const attempt = queuedAttempt([failed, OK]);
    await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: stubColdFactory(),
      attempt,
      log: stubLog(),
      otpBudget: stubBudget(0),
      loginWitness: witness,
    });
    return attempt;
  }

  it('refuses when no login ever completed, because an SMS may already be gone', async () => {
    const noLogin = stubWitness('');
    const attempt = await runRejectedWarm(noLogin, REJECTED);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('refuses when the completed login minted a token the cache did not hold', async () => {
    const coldMint = stubWitness('freshly-minted-token');
    const attempt = await runRejectedWarm(coldMint, REJECTED);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('refuses on an auth rejection, which may have spent a mid-scrape login', async () => {
    const warmOk = stubWitness(CACHED_TOKEN);
    const attempt = await runRejectedWarm(warmOk, AUTH_REJECTED);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries when the warm login completed on the cached token and cost nothing', async () => {
    const warmDone = stubWitness(CACHED_TOKEN);
    const attempt = await runRejectedWarm(warmDone, REJECTED);

    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('names the evidence it relied on when it refuses', async () => {
    const { cache } = stubCache();
    const messages: string[] = [];
    await scrapeWithWarmFallback({
      cache,
      cachedToken: CACHED_TOKEN,
      warmCreds: WARM_CREDS,
      coldCreds: stubColdFactory(),
      attempt: queuedAttempt([REJECTED, OK]),
      log: recordingLog(messages),
      otpBudget: stubBudget(0),
      loginWitness: stubWitness(''),
    });

    const joined = messages.join(' ');
    expect(joined).toContain('cannot prove');
  });
});
