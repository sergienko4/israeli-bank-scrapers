/**
 * PepperDurableState — in-memory transforms the real-E2E durable harness
 * applies to a cached Pepper state. Nothing here reads or writes the cache.
 *
 * The identity and freshness rules come from production (`formatPhoneNumber`,
 * the codec, `isJwtFresh` and Pepper's own config), so the harness predicts
 * exactly what the scraper will do with the state instead of restating it.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { IJwtClaimsConfig } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { isJwtFresh } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/Jwt/GenericJwtClaims.js';
import {
  decodePersistentAuthState,
  encodePersistentAuthState,
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
} from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import { formatPhoneNumber } from '../../Scrapers/Pipeline/Mediator/Credentials/PhoneFormatter.js';
import { PEPPER_API_DIRECT_CALL } from '../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js';
import { isOk } from '../../Scrapers/Pipeline/Types/Procedure.js';
import { makeJwtExpiringIn } from '../Helpers/Jwt.js';

/** What a plain resume of the cached state will do. */
type ResumeOutcome = 'replay' | 'renew';

/** Seconds before now the forced token expired. */
const FORCED_EXPIRY_AGE_SECONDS = 3600;

/**
 * Margin a token must clear beyond Pepper's own before the harness expects a
 * replay — covers the seconds between this check and the scraper's.
 */
const REPLAY_BUFFER_SECONDS = 120;

/**
 * Identity the state must match, normalized exactly as the pipeline does.
 * @param phoneNumber - Raw phone credential.
 * @returns Codec expectation.
 */
function expectationFor(phoneNumber: string): IPersistentAuthExpectation {
  const account = formatPhoneNumber(phoneNumber, 'international-flat');
  if (!isOk(account)) throw new ScraperError('phone number cannot be normalized');
  return { provider: 'pepper', account: account.value };
}

/**
 * Decode a cached state for this account.
 * @param encoded - Cached state.
 * @param expected - Identity it must match.
 * @returns Decoded state fields.
 */
function decodeStored(
  encoded: string,
  expected: IPersistentAuthExpectation,
): IPersistentAuthStateV1 {
  const decoded = decodePersistentAuthState(encoded, expected);
  if (!isOk(decoded)) throw new ScraperError(decoded.errorMessage);
  return decoded.value.state;
}

/**
 * Swap only the access token for an expired synthetic JWT, in memory. Device,
 * instance and key fields are untouched, and nothing is written.
 * @param encoded - Cached state.
 * @param phoneNumber - Raw phone credential.
 * @returns State that must take the renewal path.
 */
function forceExpiry(encoded: string, phoneNumber: string): string {
  const expected = expectationFor(phoneNumber);
  const stored = decodeStored(encoded, expected);
  const accessToken = makeJwtExpiringIn(-FORCED_EXPIRY_AGE_SECONDS);
  const reencoded = encodePersistentAuthState({ ...stored, accessToken }, expected);
  if (!isOk(reencoded)) throw new ScraperError(reencoded.errorMessage);
  return reencoded.value;
}

/**
 * Pepper's durable freshness rule, optionally tightened.
 * @param extraSeconds - Seconds added to Pepper's own margin.
 * @returns Claim config for `isJwtFresh`.
 */
function pepperFreshness(extraSeconds: number): IJwtClaimsConfig {
  const freshnessField = PEPPER_API_DIRECT_CALL.jwtClaims?.freshnessField;
  const margin = PEPPER_API_DIRECT_CALL.persistentAuth?.freshnessMarginSeconds;
  if (freshnessField === undefined || margin === undefined) {
    throw new ScraperError('Pepper durable freshness config missing');
  }
  return { freshnessField, skewSeconds: margin + extraSeconds };
}

/**
 * Predict a plain resume. A token too close to the margin to call is refused
 * before any scrape, so the scraper's own check can never land the other way.
 * @param encoded - Cached state.
 * @param phoneNumber - Raw phone credential.
 * @returns `replay` for a fresh token, `renew` for an expired one.
 */
function resumeOutcomeOf(encoded: string, phoneNumber: string): ResumeOutcome {
  const expected = expectationFor(phoneNumber);
  const { accessToken } = decodeStored(encoded, expected);
  const bufferedRule = pepperFreshness(REPLAY_BUFFER_SECONDS);
  if (isJwtFresh(accessToken, bufferedRule)) return 'replay';
  const pepperRule = pepperFreshness(0);
  if (!isJwtFresh(accessToken, pepperRule)) return 'renew';
  const waitSeconds = String(REPLAY_BUFFER_SECONDS);
  throw new ScraperError(`cached token is at the replay margin; rerun in ${waitSeconds}s`);
}

export type { ResumeOutcome };
export { expectationFor, forceExpiry, REPLAY_BUFFER_SECONDS, resumeOutcomeOf };
