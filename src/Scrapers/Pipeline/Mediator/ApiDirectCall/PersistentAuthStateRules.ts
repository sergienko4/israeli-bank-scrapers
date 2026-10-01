/**
 * PersistentAuthStateRules — the v1 durable-state schema and its ordered
 * field rules. Each rule names a field category; the codec reports only that
 * category, never a value. Provider-agnostic: the expected provider tag is
 * passed in from the bank's config.
 */

import { decodeNumericClaim } from './Jwt/GenericJwtClaims.js';

/** Decoded v1 payload — the only shape the codec accepts or emits. */
interface IPersistentAuthStateV1 {
  readonly version: 1;
  readonly provider: string;
  readonly account: string;
  readonly clientInstanceId: string;
  readonly deviceId: string;
  readonly accessToken: string;
  readonly ecPrivateKeyPkcs8Base64: string;
}

/** Identity a decoded state must match before any network use. */
interface IPersistentAuthExpectation {
  /** Provider tag supplied by the bank's persistent-auth config. */
  readonly provider: string;
  /** Current normalized account identifier. */
  readonly account: string;
}

/** Parsed JSON object still under validation. */
type RawState = Readonly<Record<string, unknown>>;

/** One validation rule: the failure category and the check that guards it. */
interface IStateRule {
  readonly category: string;
  readonly isValid: (raw: RawState, expected: IPersistentAuthExpectation) => boolean;
}

const KIB = 1024;
const MAX_ACCOUNT_CHARS = 32;
const MAX_DEVICE_ID_CHARS = 256;
const MAX_ACCESS_TOKEN_CHARS = 16 * KIB;
const MAX_EC_KEY_CHARS = 2 * KIB;
const STATE_VERSION = 1;
const JWT_SEGMENT_COUNT = 3;
/** Exact v1 keys in publication order; also the JSON.stringify whitelist. */
const STATE_KEYS: readonly string[] = [
  'version',
  'provider',
  'account',
  'clientInstanceId',
  'deviceId',
  'accessToken',
  'ecPrivateKeyPkcs8Base64',
];
const UUID_V4_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
const BASE64URL_SEGMENT_PATTERN = /^[\w-]+$/;

/**
 * Whether a value is a non-empty string no longer than the cap.
 * @param value - Candidate value.
 * @param maxChars - Inclusive length cap.
 * @returns True for a bounded non-empty string.
 */
function isBoundedString(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars;
}

/**
 * Whether the object has exactly the v1 keys — none missing, none extra.
 * @param raw - Parsed state object.
 * @returns True when the key set matches.
 */
function hasExactKeys(raw: RawState): boolean {
  const keys = Object.keys(raw);
  if (keys.length !== STATE_KEYS.length) return false;
  return STATE_KEYS.every((key): boolean => Object.hasOwn(raw, key));
}

/**
 * Whether the state declares the supported schema version.
 * @param raw - Parsed state object.
 * @returns True for version 1.
 */
function isSupportedVersion(raw: RawState): boolean {
  return raw.version === STATE_VERSION;
}

/**
 * Whether the state belongs to the provider whose config requested it.
 * @param raw - Parsed state object.
 * @param expected - Expected provider and account.
 * @returns True on an exact provider match.
 */
function isExpectedProvider(raw: RawState, expected: IPersistentAuthExpectation): boolean {
  return raw.provider === expected.provider;
}

/**
 * Whether the state was enrolled for the account now being scraped.
 * @param raw - Parsed state object.
 * @param expected - Expected provider and account.
 * @returns True on a bounded, exact account match.
 */
function isExpectedAccount(raw: RawState, expected: IPersistentAuthExpectation): boolean {
  return isBoundedString(raw.account, MAX_ACCOUNT_CHARS) && raw.account === expected.account;
}

/**
 * Whether the client instance ID is a canonical lowercase UUID v4.
 * @param raw - Parsed state object.
 * @returns True for a canonical UUID v4.
 */
function isCanonicalInstanceId(raw: RawState): boolean {
  const id = raw.clientInstanceId;
  return typeof id === 'string' && UUID_V4_PATTERN.test(id);
}

/**
 * Whether the server-issued device ID is present and bounded.
 * @param raw - Parsed state object.
 * @returns True for a bounded device ID.
 */
function isBoundedDeviceId(raw: RawState): boolean {
  return isBoundedString(raw.deviceId, MAX_DEVICE_ID_CHARS);
}

/**
 * Whether a token is a three-segment compact JWT carrying a numeric `exp`.
 * @param token - Candidate compact JWT.
 * @returns True for a structurally valid JWT.
 */
function isStructuralJwt(token: string): boolean {
  const segments = token.split('.');
  if (segments.length !== JWT_SEGMENT_COUNT) return false;
  const isEncoded = segments.every((s): boolean => BASE64URL_SEGMENT_PATTERN.test(s));
  return isEncoded && decodeNumericClaim(token, 'exp') !== false;
}

/**
 * Whether the access token is bounded and structurally a JWT with `exp`.
 * @param raw - Parsed state object.
 * @returns True for a usable access token.
 */
function isBoundedJwt(raw: RawState): boolean {
  const token = raw.accessToken;
  return isBoundedString(token, MAX_ACCESS_TOKEN_CHARS) && isStructuralJwt(token);
}

/**
 * Whether the PKCS#8 text is present and bounded; key import checks the rest.
 * @param raw - Parsed state object.
 * @returns True for bounded key text.
 */
function isBoundedKeyText(raw: RawState): boolean {
  return isBoundedString(raw.ecPrivateKeyPkcs8Base64, MAX_EC_KEY_CHARS);
}

/** Ordered field rules; the first failing rule names the error category. */
const STATE_RULES: readonly IStateRule[] = [
  { category: 'shape', isValid: hasExactKeys },
  { category: 'version', isValid: isSupportedVersion },
  { category: 'provider', isValid: isExpectedProvider },
  { category: 'account', isValid: isExpectedAccount },
  { category: 'clientInstanceId', isValid: isCanonicalInstanceId },
  { category: 'deviceId', isValid: isBoundedDeviceId },
  { category: 'accessToken', isValid: isBoundedJwt },
  { category: 'ecPrivateKey', isValid: isBoundedKeyText },
];

export type { IPersistentAuthExpectation, IPersistentAuthStateV1, RawState };
export { STATE_KEYS, STATE_RULES };
