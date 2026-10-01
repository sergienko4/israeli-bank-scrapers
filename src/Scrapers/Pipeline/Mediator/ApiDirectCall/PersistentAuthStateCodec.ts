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

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { type IGenericKeypair, importEcP256Pkcs8 } from './Crypto/CryptoKeyFactory.js';
import {
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
  type RawState,
  STATE_KEYS,
  STATE_RULES,
} from './PersistentAuthStateRules.js';

/** Validated state plus its rehydrated EC keypair. */
interface IRehydratedPersistentAuth {
  readonly state: IPersistentAuthStateV1;
  readonly ecKeypair: IGenericKeypair;
}

/**
 * Encoded-length cap. Base64 maps 3 bytes to 4 characters, so 32 KiB of text
 * also bounds the decoded JSON at the 24 KiB the contract allows.
 */
const MAX_ENCODED_CHARS = 32 * 1024;

/**
 * Build the category-only failure every invalid state returns.
 * @param category - Field category that failed; never a value.
 * @returns Procedure failure.
 */
function invalid(category: string): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, `persistent auth state invalid: ${category}`);
}

/**
 * Decode strict UTF-8 without throwing.
 * @param bytes - Raw bytes.
 * @returns Decoded text, or false on any invalid sequence.
 */
function tryDecodeUtf8(bytes: Buffer): string | false {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
}

/**
 * Unwrap the canonical unpadded base64url envelope into JSON text.
 * @param encoded - Opaque state as supplied by the caller.
 * @returns JSON text, or an `encoding` failure.
 */
function decodeEnvelope(encoded: string): Procedure<string> {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CHARS) return invalid('encoding');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) return invalid('encoding');
  const text = tryDecodeUtf8(bytes);
  if (text === false) return invalid('encoding');
  return succeed(text);
}

/**
 * Parse JSON without throwing, keeping only a plain-object root.
 * @param text - JSON text.
 * @returns Parsed object, or false for a syntax error or non-object root.
 */
function tryParseObject(text: string): RawState | false {
  try {
    const parsed = JSON.parse(text) as unknown;
    const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return isObject ? (parsed as RawState) : false;
  } catch {
    return false;
  }
}

/**
 * Apply every field rule in order.
 * @param raw - Parsed state object.
 * @param expected - Expected provider and account.
 * @returns Typed state, or the first failing rule's category.
 */
function validateFields(
  raw: RawState,
  expected: IPersistentAuthExpectation,
): Procedure<IPersistentAuthStateV1> {
  const broken = STATE_RULES.find((rule): boolean => !rule.isValid(raw, expected));
  if (broken !== undefined) return invalid(broken.category);
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
  const text = decodeEnvelope(encoded);
  if (!isOk(text)) return text;
  const raw = tryParseObject(text.value);
  if (raw === false) return invalid('json');
  return validateFields(raw, expected);
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
  if (!isOk(keyProc)) return invalid('ecPrivateKey');
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
  const json = JSON.stringify(state, [...STATE_KEYS]);
  const encoded = Buffer.from(json, 'utf8').toString('base64url');
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
