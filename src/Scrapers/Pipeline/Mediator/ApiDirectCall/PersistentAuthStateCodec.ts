/**
 * PersistentAuthStateCodec — strict v1 codec for the opaque durable
 * device-auth state handed to `onPersistentAuthStateUpdate` and read back from
 * `persistentAuthState`.
 *
 * <p>The wire form is unpadded base64url over UTF-8 JSON. Every check runs
 * locally, before any auth request, and every failure names only a field
 * category — never a value — because the state carries a bearer token and a
 * device private key.
 */

import type { JsonUnknownRecord } from '../../Types/JsonValue.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { type IGenericKeypair, importEcP256Pkcs8 } from './Crypto/CryptoKeyFactory.js';
import { decodeStateObject, encodeStateObject, invalidState } from './PersistentAuthEnvelope.js';
import {
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
  STATE_KEYS,
  STATE_RULES,
} from './PersistentAuthStateRules.js';

/** Validated state plus its rehydrated EC keypair. */
interface IRehydratedPersistentAuth {
  readonly state: IPersistentAuthStateV1;
  readonly ecKeypair: IGenericKeypair;
}

/**
 * Apply every field rule in order.
 * @param raw - Parsed state object.
 * @param expected - Expected provider and account.
 * @returns Typed state, or the first failing rule's category.
 */
function validateFields(
  raw: JsonUnknownRecord,
  expected: IPersistentAuthExpectation,
): Procedure<IPersistentAuthStateV1> {
  const broken = STATE_RULES.find((rule): boolean => !rule.isValid(raw, expected));
  if (broken !== undefined) return invalidState(broken.category);
  return succeed(raw as unknown as IPersistentAuthStateV1);
}

/**
 * Decode the envelope, parse JSON, and validate every field.
 * @param encoded - Opaque state as supplied by the caller.
 * @param expected - Provider tag from config and the current account.
 * @returns Typed state, or a category-only failure.
 */
function decodeStateFields(
  encoded: string,
  expected: IPersistentAuthExpectation,
): Procedure<IPersistentAuthStateV1> {
  const raw = decodeStateObject(encoded);
  if (!isOk(raw)) return raw;
  return validateFields(raw.value, expected);
}

/**
 * Decode and fully validate opaque state, then rehydrate its EC key. Runs no
 * network request.
 * @param encoded - Opaque state as supplied by the caller.
 * @param expected - Provider tag from config and the current account.
 * @returns Validated state plus keypair, or a category-only failure.
 */
function decodePersistentAuthState(
  encoded: string,
  expected: IPersistentAuthExpectation,
): Procedure<IRehydratedPersistentAuth> {
  const state = decodeStateFields(encoded, expected);
  if (!isOk(state)) return state;
  const keyProc = importEcP256Pkcs8(state.value.ecPrivateKeyPkcs8Base64);
  if (!isOk(keyProc)) return invalidState('ecPrivateKey');
  return succeed({ state: state.value, ecKeypair: keyProc.value });
}

/**
 * Encode state for publication. The output is decoded again before it is
 * returned, so a state the next run would reject is never published.
 * @param state - State to publish.
 * @param expected - Provider tag from config and the current account.
 * @returns Opaque unpadded base64url state, or a category-only failure.
 */
function encodePersistentAuthState(
  state: IPersistentAuthStateV1,
  expected: IPersistentAuthExpectation,
): Procedure<string> {
  const encoded = encodeStateObject(state, STATE_KEYS);
  const roundTrip = decodePersistentAuthState(encoded, expected);
  if (!isOk(roundTrip)) return roundTrip;
  return succeed(encoded);
}

export type { IRehydratedPersistentAuth };
export { decodePersistentAuthState, encodePersistentAuthState };

export {
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
} from './PersistentAuthStateRules.js';
