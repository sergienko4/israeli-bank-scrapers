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
 * cache, so the next attempt performs a genuine SMS-OTP login — but only when
 * the run has not already sent a message. The retry builds a second scraper,
 * and a second scraper carries its own production cold-flow budget, so nothing
 * below this helper can see that an SMS was already spent. `otpBudget` is what
 * spans both attempts.
 *
 * <p>The header used to claim the retry "never doubles the bank traffic"
 * because it only fires on the warm path. That reasoning was wrong: the warm
 * path is exactly where a rejected token costs one message inside the first
 * attempt (the mediator's own warm→cold fallback) and another in the retry.
 * The guard is the budget, not the branch.
 */

import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { isAuthRejectionMessage } from '../../Scrapers/Pipeline/Mediator/Api/ApiMediator.authReject.js';
import { redactErrorMessage } from '../../Scrapers/Pipeline/Types/PiiRedactor/ErrorLog.js';
import type { ILoginWitness } from './LoginWitness.js';
import type { IOtpBudget } from './OtpBudget.js';
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
  /**
   * Messages this run has already sent.
   *
   * <p>Required, not optional: a suite that forgot it would silently go back
   * to costing two messages per run, and no assertion inside this helper
   * could catch that. The type system can, so it does.
   */
  readonly otpBudget: IOtpBudget;
  /**
   * What the first attempt's login actually did.
   *
   * <p>The budget alone cannot clear a retry — it only proves no OTP code was
   * *collected*, not that none was *sent*. The witness supplies the missing
   * half: proof that a login completed, and on which token.
   */
  readonly loginWitness: ILoginWitness;
}

/**
 * Whether this run has already sent an SMS.
 *
 * <p>A run without a budget reports nothing rather than guessing: the previous
 * behaviour was to retry unconditionally, and a suite that has not opted in
 * keeps it.
 * @param args - Fallback bundle.
 * @returns True when a message has already gone out.
 */
function hasSpentSms(args: IWarmFallbackArgs): boolean {
  const messages = args.otpBudget.spent();
  return messages > 0;
}

/**
 * Whether the run can be *proven* to have sent no message yet.
 *
 * <p>Three independent things must hold, and each closes a different way a
 * message can escape unnoticed:
 *
 * <ul>
 *   <li>no OTP code was collected — the retriever was never called;</li>
 *   <li>the failure is not an auth rejection — because the retry layer answers
 *       one with a refresh, and hands back the original 401/403 when that
 *       refresh fails, so the marker is the only trace a mid-scrape login
 *       left behind;</li>
 *   <li>the only login that completed re-reported the token we already had —
 *       a cold login would have reported a different one, and no login at all
 *       reports nothing.</li>
 * </ul>
 * @param args - Fallback bundle.
 * @param failed - The warm-path failure under consideration.
 * @returns True only when a retry provably costs the run's first message.
 */
function isRetrySafe(args: IWarmFallbackArgs, failed: IScraperScrapingResult): boolean {
  const hasSpent = hasSpentSms(args);
  if (hasSpent) return false;
  const isRejected = isAuthRejectionMessage(failed.errorMessage ?? '');
  if (isRejected) return false;
  const witnessed = args.loginWitness.lastToken();
  return witnessed === args.cachedToken;
}

/**
 * Return the warm failure untouched, having refused to buy another message.
 *
 * <p>The cache is deliberately left alone, whichever evidence triggered the
 * refusal. When a cold login did complete, the same writer has already
 * replaced the cache entry with the token it minted, and for OneZero minting
 * a replacement revokes the old one (issue #580) — deleting it would be
 * unrecoverable. When no login completed, the entry is merely stale, and a
 * stale entry costs one failed warm attempt next run, which the production
 * budget then caps at a single cold escalation. Keeping it is never worse
 * than deleting it.
 * @param args - Fallback bundle.
 * @param failed - The warm-path result being returned as-is.
 * @returns The original failure.
 */
function refuseSecondSms(
  args: IWarmFallbackArgs,
  failed: IScraperScrapingResult,
): IScraperScrapingResult {
  args.log.warn(
    { errorType: failed.errorType, errorMessage: redactErrorMessage(failed.errorMessage ?? '') },
    'Warm path rejected, but this run cannot prove it has not already sent an ' +
      'SMS — refusing a second login and keeping the cached token',
  );
  return failed;
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
    { errorType: failed.errorType, errorMessage: redactErrorMessage(failed.errorMessage ?? '') },
    'Warm path rejected — invalidating cached token and retrying with SMS OTP',
  );
  await args.cache.invalidate();
  const creds = args.coldCreds();
  return args.attempt(creds);
}

/**
 * Run the scrape, falling back to a cold SMS-OTP login when a cached
 * long-term token is rejected — but never at the cost of a second message.
 * @param args - Cache handle, both credential shapes, and the attempt fn.
 * @returns The warm result when it succeeds, else the cold retry's result.
 */
async function scrapeWithWarmFallback(args: IWarmFallbackArgs): Promise<IScraperScrapingResult> {
  const isWarm = args.cachedToken.length > 0;
  const creds = isWarm ? args.warmCreds : args.coldCreds();
  const first = await args.attempt(creds);
  if (first.success) return first;
  if (!isWarm) return first;
  const canRetry = isRetrySafe(args, first);
  if (!canRetry) return refuseSecondSms(args, first);
  return retryCold(args, first);
}

export type { ColdCredsFactory, IWarmFallbackArgs, ScrapeAttempt };
export { scrapeWithWarmFallback };
