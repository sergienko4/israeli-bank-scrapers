/**
 * WarmPathFallback — test-only helper that makes the cached-token ("warm")
 * path self-healing.
 *
 * <p>The real-E2E suites pick warm credentials whenever a long-term token is
 * on disk. A token that the bank has since expired is indistinguishable from
 * a valid one until the scrape runs, and the rejection surfaces as the bank's
 * own opaque error (Pepper answers an expired session with a GraphQL envelope
 * carrying `Request failed with status code 500`). Without a fallback the run
 * fails, the stale token stays cached, and every later run repeats the same
 * failure — which reads exactly like a code regression.
 *
 * <p>This helper retries ONCE with cold credentials after invalidating the
 * cache, so the next attempt performs a genuine SMS-OTP login. The retry is
 * attempted only when the warm path was actually taken, so a cold-path
 * failure never doubles the bank traffic.
 */

import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import type { ITokenCacheHandle } from './TokenCache.js';

/** One scrape attempt against a given credential shape. */
type ScrapeAttempt = (creds: ScraperCredentials) => Promise<IScraperScrapingResult>;

/**
 * Builds a cold (SMS-OTP) credential shape.
 *
 * <p>This is a factory, not a value, because `createOtpPoller` memoises the
 * code it resolves for the lifetime of one retriever instance — a deliberate
 * design so multi-step logins (PayBox confirms the same OTP twice) prompt the
 * user once. Reusing that retriever for the retry would replay an
 * already-consumed code and fail the fresh login, so each attempt gets its own
 * retriever.
 */
type ColdCredsFactory = () => ScraperCredentials;

/** Args bundle for scrapeWithWarmFallback — respects the 3-param ceiling. */
interface IWarmFallbackArgs {
  readonly cache: ITokenCacheHandle;
  readonly cachedToken: string;
  readonly warmCreds: ScraperCredentials;
  readonly coldCreds: ColdCredsFactory;
  readonly attempt: ScrapeAttempt;
  readonly log: ScraperLogger;
}

/**
 * Invalidate the rejected token and re-run the scrape from cold.
 * @param args - Fallback bundle.
 * @param failed - The failed warm-path result, logged for diagnosis.
 * @returns Result of the cold retry.
 */
async function retryCold(
  args: IWarmFallbackArgs,
  failed: IScraperScrapingResult,
): Promise<IScraperScrapingResult> {
  args.log.warn(
    { errorType: failed.errorType, errorMessage: failed.errorMessage },
    'Warm path rejected — invalidating cached token and retrying with SMS OTP',
  );
  await args.cache.invalidate();
  const creds = args.coldCreds();
  return args.attempt(creds);
}

/**
 * Run the scrape, falling back to a cold SMS-OTP login when a cached
 * long-term token is rejected.
 * @param args - Cache handle, both credential shapes, and the attempt fn.
 * @returns The warm result when it succeeds, else the cold retry's result.
 */
async function scrapeWithWarmFallback(args: IWarmFallbackArgs): Promise<IScraperScrapingResult> {
  const isWarm = args.cachedToken.length > 0;
  const creds = isWarm ? args.warmCreds : args.coldCreds();
  const first = await args.attempt(creds);
  if (first.success) return first;
  if (!isWarm) return first;
  return retryCold(args, first);
}

export type { ColdCredsFactory, IWarmFallbackArgs, ScrapeAttempt };
export { scrapeWithWarmFallback };
