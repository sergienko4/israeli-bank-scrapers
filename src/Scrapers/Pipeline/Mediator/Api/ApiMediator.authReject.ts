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
 *
 * <p>{@link isAuthRejectedFailure} (N28) asks the wider question a warm-start
 * gate needs: a login step's failure is sanitised to `<step> HTTP 401`, which
 * the transport marker above never matches.
 */

import type { IProcedureFailure } from '../../Types/Procedure.js';
import { isWafBlocked } from '../../Types/Procedure.js';

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
 * Matches the `<sp>HTTP 401` / `<sp>HTTP 403` that ends a sanitised login
 * step (`RunStep.failure.ts`) or a status-policy refusal (`StatusPolicy.ts`).
 * This form must end the message, so `HTTP 4010` is not a rejection.
 */
const AUTH_REJECTED_SUFFIX_REGEX = /\sHTTP (?:401|403)$/;

/**
 * Whether an error message carries the bank's auth-rejection marker.
 * @param message - Error message to inspect.
 * @returns True when the message reads as a 401/403 rejection.
 */
function isAuthRejectionMessage(message: string): boolean {
  return AUTH_REJECT_REGEX.test(message);
}

/**
 * Whether a failure is the bank refusing the credentials or the session, in
 * either marker form. An edge block is never one: a Cloudflare block keeps the
 * transport's `403:` prefix, but the bank never saw the call.
 * @param failure - Failure to inspect.
 * @returns True for a 401/403 the bank answered.
 */
function isAuthRejectedFailure(failure: IProcedureFailure): boolean {
  if (isWafBlocked(failure)) return false;
  return (
    AUTH_REJECT_REGEX.test(failure.errorMessage) ||
    AUTH_REJECTED_SUFFIX_REGEX.test(failure.errorMessage)
  );
}

export default isAuthRejectionMessage;
export { isAuthRejectedFailure, isAuthRejectionMessage };
