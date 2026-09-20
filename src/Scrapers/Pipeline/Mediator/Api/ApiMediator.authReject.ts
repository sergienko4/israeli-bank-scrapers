/**
 * The single definition of "this failure is the bank rejecting our bearer".
 *
 * <p>Extracted from `ApiMediator.retry.ts` so the real-E2E warm-path fallback
 * can ask the same question the retry layer asks. The fallback must know
 * whether a failed scrape passed through {@link retryOn401Op}'s refresh — a
 * refresh that fails is reported as the *original* 401/403, so that marker is
 * the only evidence left that a cold login (and therefore an SMS) may have
 * been attempted mid-scrape. Duplicating the pattern in the harness would let
 * the two drift apart silently, which is exactly the class of bug the harness
 * exists to catch.
 */

/**
 * Matches the embedded HTTP status prefix `<sp>401:<sp>` or `<sp>403:<sp>`.
 *
 * Most banks reject a stale or invalid bearer with 401, but Pepper sits
 * behind a CloudFront edge that answers 403 with a block page before the
 * API is reached. Without 403 here a stale warm-path token can never be
 * re-minted and the scrape fails hard instead of falling back to a cold
 * login.
 */
const AUTH_REJECT_REGEX = /\s(?:401|403):\s/;

/**
 * Whether an error message carries the bank's auth-rejection marker.
 * @param message - Error message to inspect.
 * @returns True when the message reads as a 401/403 rejection.
 */
function isAuthRejectionMessage(message: string): boolean {
  return AUTH_REJECT_REGEX.test(message);
}

export default isAuthRejectionMessage;
export { isAuthRejectionMessage };
