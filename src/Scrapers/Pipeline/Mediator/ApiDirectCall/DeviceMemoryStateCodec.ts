/**
 * DeviceMemoryStateCodec — strict v1 codec for the device-memory durable
 * state: the server-issued device id, bound to one provider and account.
 *
 * <p>Shares the outer envelope with the bound-device codec. A state of
 * another kind — including a stored bound-device state, which has no `kind`
 * key — fails the `shape` rule before any field is read. Failures name a
 * category only.
 */

import type { JsonUnknownRecord } from '../../Types/JsonValue.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import {
  decodeStateObject,
  encodeStateObject,
  hasExactKeySet,
  invalidState,
} from './PersistentAuthEnvelope.js';
import {
  type IPersistentAuthExpectation,
  isBoundedString,
  isExpectedProvider,
  isSupportedVersion,
  type IStateRule,
} from './PersistentAuthStateRules.js';

/** Decoded v1 device-memory payload — the only shape accepted or emitted. */
interface IDeviceMemoryStateV1 {
  readonly version: 1;
  readonly kind: 'device-memory';
  readonly provider: string;
  readonly account: string;
  readonly deviceId: string;
}

const STATE_KIND = 'device-memory';
const MAX_ACCOUNT_CHARS = 64;
/** Exact v1 keys in publication order; also the JSON.stringify whitelist. */
const DEVICE_MEMORY_KEYS: readonly string[] = [
  'version',
  'kind',
  'provider',
  'account',
  'deviceId',
];
const DEVICE_ID_PATTERN = /^[\w.:-]{1,256}$/;

/**
 * Whether a value is a device id the state may hold.
 * @param value - Candidate value.
 * @returns True for 1–256 characters of letters, digits, `.`, `_`, `:` or `-`.
 */
function isDeviceMemoryId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

/**
 * Whether the object has exactly the device-memory keys.
 * @param raw - Parsed state object.
 * @returns True when the key set matches.
 */
function hasDeviceMemoryKeys(raw: JsonUnknownRecord): boolean {
  return hasExactKeySet(raw, DEVICE_MEMORY_KEYS);
}

/**
 * Whether the state declares the device-memory kind.
 * @param raw - Parsed state object.
 * @returns True for `device-memory`.
 */
function isDeviceMemoryKind(raw: JsonUnknownRecord): boolean {
  return raw.kind === STATE_KIND;
}

/**
 * Whether the state was enrolled for the account now being scraped.
 * @param raw - Parsed state object.
 * @param expected - Expected provider and lower-cased account.
 * @returns True on a bounded, exact account match.
 */
function isExpectedAccount(raw: JsonUnknownRecord, expected: IPersistentAuthExpectation): boolean {
  return isBoundedString(raw.account, MAX_ACCOUNT_CHARS) && raw.account === expected.account;
}

/**
 * Whether the stored device id meets the pattern.
 * @param raw - Parsed state object.
 * @returns True for a usable device id.
 */
function hasDeviceMemoryId(raw: JsonUnknownRecord): boolean {
  return isDeviceMemoryId(raw.deviceId);
}

/** Ordered field rules; the first failing rule names the error category. */
const DEVICE_MEMORY_RULES: readonly IStateRule[] = [
  { category: 'shape', isValid: hasDeviceMemoryKeys },
  { category: 'version', isValid: isSupportedVersion },
  { category: 'kind', isValid: isDeviceMemoryKind },
  { category: 'provider', isValid: isExpectedProvider },
  { category: 'account', isValid: isExpectedAccount },
  { category: 'deviceId', isValid: hasDeviceMemoryId },
];

/**
 * Decode and fully validate a device-memory state. Runs no request.
 * @param encoded - Opaque state as supplied by the caller.
 * @param expected - Provider tag from config and the lower-cased account.
 * @returns Typed state, or a category-only failure.
 */
function decodeDeviceMemoryState(
  encoded: string,
  expected: IPersistentAuthExpectation,
): Procedure<IDeviceMemoryStateV1> {
  const raw = decodeStateObject(encoded);
  if (!isOk(raw)) return raw;
  const broken = DEVICE_MEMORY_RULES.find((rule): boolean => !rule.isValid(raw.value, expected));
  if (broken !== undefined) return invalidState(broken.category);
  return succeed(raw.value as unknown as IDeviceMemoryStateV1);
}

/**
 * Encode a device-memory state. The output is decoded again before it is
 * returned, so a state the next run would reject is never published.
 * @param state - State to publish.
 * @param expected - Provider tag from config and the lower-cased account.
 * @returns Opaque unpadded base64url state, or a category-only failure.
 */
function encodeDeviceMemoryState(
  state: IDeviceMemoryStateV1,
  expected: IPersistentAuthExpectation,
): Procedure<string> {
  const encoded = encodeStateObject(state, DEVICE_MEMORY_KEYS);
  const roundTrip = decodeDeviceMemoryState(encoded, expected);
  if (!isOk(roundTrip)) return roundTrip;
  return succeed(encoded);
}

export type { IDeviceMemoryStateV1 };
export { decodeDeviceMemoryState, encodeDeviceMemoryState, isDeviceMemoryId };
