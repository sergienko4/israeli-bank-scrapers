/**
 * Public-boundary validation — refuse invalid options or credentials before
 * a bank's credential enricher or the first phase request runs.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import { checkCredentialRules } from '../Mediator/ApiDirectCall/Flow/RequiredCreds.js';
import { MAX_ENCODED_CHARS } from '../Mediator/ApiDirectCall/PersistentAuthEnvelope.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** The descriptor's credential-policy slice. */
type CredentialPolicy = NonNullable<IPipelineDescriptor['credentialPolicy']>;

/** Highest accepted future-months window. */
const MAX_FUTURE_MONTHS = 24;
/** Longest ordinary credential the boundary accepts. */
const MAX_CREDENTIAL_LENGTH = 256;
/** Longest device signature the boundary accepts. */
const MAX_DEVICE_SIGNATURE_LENGTH = 8_192;
/** Longest long-term token or persisted auth state the boundary accepts. */
const MAX_TOKEN_LENGTH = 16_384;

/** Per-field length caps beyond the ordinary limit. */
const LONG_FIELD_LIMITS: Readonly<Record<string, number>> = {
  deviceSignature: MAX_DEVICE_SIGNATURE_LENGTH,
  otpLongTermToken: MAX_TOKEN_LENGTH,
};

/**
 * Read the length cap for one credential field.
 * @param field - Credential field name.
 * @returns The field's cap.
 */
function capFor(field: string): number {
  if (Object.hasOwn(LONG_FIELD_LIMITS, field)) return LONG_FIELD_LIMITS[field];
  return MAX_CREDENTIAL_LENGTH;
}

/**
 * Refuse an invalid start date.
 * @param options - Scraper options.
 * @returns Success, or a typed failure.
 */
/**
 * Read a value's timestamp without trusting its prototype or getTime method.
 * @param value - Candidate Date, possibly from another realm.
 * @returns The timestamp, or false when it is not a Date.
 */
function readStartTime(value: unknown): number | false {
  try {
    return Date.prototype.getTime.call(value);
  } catch {
    return false;
  }
}

/**
 * Refuse an invalid start date.
 * @param options - Scraper options.
 * @returns Success, or a typed failure.
 */
function validStartDate(options: ScraperOptions): Procedure<true> {
  const time = readStartTime(options.startDate);
  if (time !== false && Number.isFinite(time)) return succeed(true);
  return fail(ScraperErrorTypes.Generic, 'startDate must be a valid date');
}

/**
 * Refuse an out-of-range future-months window.
 * @param options - Scraper options.
 * @returns Success, or a typed failure.
 */
function validFutureMonths(options: ScraperOptions): Procedure<true> {
  const raw = options.futureMonthsToScrape as number | null | undefined;
  if (raw === undefined || raw === null) return succeed(true);
  if (Number.isInteger(raw) && raw >= 0 && raw <= MAX_FUTURE_MONTHS) return succeed(true);
  return fail(
    ScraperErrorTypes.Generic,
    `futureMonthsToScrape must be an integer between 0 and ${String(MAX_FUTURE_MONTHS)}`,
  );
}

/**
 * Refuse a persisted-auth state over the codec's envelope cap.
 * @param state - Supplied state string.
 * @returns The failure, or false when it fits.
 */
function persistentStateLengthFailure(state: string): Procedure<true> | false {
  if (state.length <= MAX_ENCODED_CHARS) return false;
  return fail(
    ScraperErrorTypes.Generic,
    `persistentAuthState exceeds ${String(MAX_ENCODED_CHARS)} characters`,
  );
}

/**
 * Refuse a non-string or oversized persisted-auth state.
 * @param options - Scraper options.
 * @returns Success, or a typed failure.
 */
function validPersistentAuthState(options: ScraperOptions): Procedure<true> {
  const state = options.persistentAuthState as string | null | undefined;
  if (state === undefined) return succeed(true);
  if (typeof state !== 'string') {
    return fail(ScraperErrorTypes.Generic, 'persistentAuthState must be a string');
  }
  const lengthFailure = persistentStateLengthFailure(state);
  return lengthFailure === false ? succeed(true) : lengthFailure;
}

/**
 * Whether the credentials value is a usable object.
 * @param credentials - Caller credentials.
 * @returns True for a non-null object.
 */
function isCredentialBag(credentials: unknown): credentials is ScraperCredentials {
  return typeof credentials === 'object' && credentials !== null;
}

/**
 * Whether one credential field is over its cap.
 * @param entry - Field name and value.
 * @returns True for an oversized string.
 */
function isOversizedEntry(entry: [string, unknown]): boolean {
  const [field, value] = entry;
  if (typeof value !== 'string') return false;
  const cap = capFor(field);
  return value.length > cap;
}

/**
 * Refuse an oversized credential field.
 * @param credentials - Caller credentials.
 * @returns Success, or a typed failure naming the field only.
 */
function validCredentialLengths(credentials: ScraperCredentials): Procedure<true> {
  const oversized = Object.entries(credentials).find(isOversizedEntry);
  if (oversized === undefined) return succeed(true);
  const [field] = oversized;
  const cap = capFor(field);
  return fail(ScraperErrorTypes.Generic, `${field} exceeds ${String(cap)} characters`);
}

/**
 * Run the option checks in order, stopping at the first failure.
 * @param options - Scraper options.
 * @returns The first failure, or false when all pass.
 */
function optionFailure(options: ScraperOptions): Procedure<true> | false {
  const start = validStartDate(options);
  if (!start.success) return start;
  const future = validFutureMonths(options);
  if (!future.success) return future;
  const state = validPersistentAuthState(options);
  return state.success ? false : state;
}

/**
 * Refuse missing or non-object credentials.
 * @param credentials - Caller credentials.
 * @param policy - Bank-declared required credentials.
 * @returns The failure, or false when the bag passes.
 */
function requiredFailure(
  credentials: ScraperCredentials,
  policy?: CredentialPolicy,
): Procedure<true> | false {
  if (!isCredentialBag(credentials)) {
    return fail(ScraperErrorTypes.Generic, 'credentials must be an object');
  }
  const required = checkCredentialRules(credentials, policy?.requiredCreds);
  return required.success ? false : required;
}

/**
 * Run the credential checks in order, stopping at the first failure.
 * @param credentials - Caller credentials.
 * @param policy - Bank-declared required credentials.
 * @returns The first failure, or false when all pass.
 */
function credentialFailure(
  credentials: ScraperCredentials,
  policy?: CredentialPolicy,
): Procedure<true> | false {
  const required = requiredFailure(credentials, policy);
  if (required !== false) return required;
  const lengths = validCredentialLengths(credentials);
  return lengths.success ? false : lengths;
}

/**
 * Validate options first, then the credential bag.
 * @param options - Scraper options.
 * @param credentials - Caller credentials.
 * @param policy - Bank-declared required credentials.
 * @returns Success, or the first typed failure.
 */
function validateBoundary(
  options: ScraperOptions,
  credentials: ScraperCredentials,
  policy?: CredentialPolicy,
): Procedure<true> {
  const option = optionFailure(options);
  if (option !== false) return option;
  const credential = credentialFailure(credentials, policy);
  return credential === false ? succeed(true) : credential;
}

export default validateBoundary;
