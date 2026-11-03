/**
 * A synthetic ECDH peer for the key exchange: fixed secp256k1 scalars for
 * the client and the bank, the key the bank derives on its own side, and
 * answers sealed under that key. Tests prove the codec against this peer, not
 * against the codec's own derivation.
 */

import { createCipheriv, createECDH, createHash, type ECDH } from 'node:crypto';

import type { JsonUnknownRecord } from '../../Scrapers/Pipeline/Types/JsonValue.js';
import { ENVELOPE_IV, ENVELOPE_IV_TEXT, ENVELOPE_SESSION_ID } from './EnvelopeOracle.js';

/** The client's private scalar, as the ECDH generator carries it. */
export const CLIENT_PRIVATE = Buffer.alloc(32, 0x22);

/** The client's private scalar, base64. */
export const CLIENT_PRIVATE_TEXT = CLIENT_PRIVATE.toString('base64');

/** The bank's private scalar. */
const SERVER_PRIVATE = Buffer.alloc(32, 0x33);

/**
 * A secp256k1 key pair from a fixed scalar.
 * @param scalar - Private scalar.
 * @returns The key pair.
 */
function ecdhOf(scalar: Buffer): ECDH {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(scalar);
  return ecdh;
}

/**
 * The client's public point, uncompressed, base64.
 * @returns The point.
 */
export function clientPublic(): string {
  return ecdhOf(CLIENT_PRIVATE).getPublicKey('base64');
}

/**
 * The bank's public point, base64.
 * @param format - Point format.
 * @returns The point.
 */
export function serverPublic(format: 'compressed' | 'uncompressed' = 'uncompressed'): string {
  return ecdhOf(SERVER_PRIVATE).getPublicKey('base64', format);
}

/**
 * The key the bank derives: SHA-256 of its ECDH secret with the client's point.
 * @returns The 32-byte session key.
 */
export function peerKey(): Buffer {
  const client = ecdhOf(CLIENT_PRIVATE).getPublicKey();
  const secret = ecdhOf(SERVER_PRIVATE).computeSecret(client);
  return createHash('sha256').update(secret).digest();
}

/**
 * The bank's `key_exchange` header.
 * @param overrides - Fields over the valid ones.
 * @returns The header.
 */
export function keyExchangeHeader(overrides: JsonUnknownRecord = {}): JsonUnknownRecord {
  const header = {
    type: 'key_exchange',
    scheme: 2,
    y: serverPublic(),
    crypto_session_id: ENVELOPE_SESSION_ID,
  };
  return { ...header, ...overrides };
}

/**
 * Seal a JSON value under a key and the fixed IV.
 * @param key - AES-256 key.
 * @param data - Value to seal.
 * @returns Ciphertext, base64.
 */
export function sealUnder(key: Buffer, data: JsonUnknownRecord): string {
  const cipher = createCipheriv('aes-256-cbc', key, ENVELOPE_IV);
  const plain = JSON.stringify(data);
  const head = cipher.update(plain, 'utf8');
  const tail = cipher.final();
  return Buffer.concat([head, tail]).toString('base64');
}

/**
 * A key-exchange answer whose data is sealed under the peer-derived key.
 * @param data - Data to seal.
 * @param headers - Headers before the `encryption` one.
 * @param encryption - Fields over the valid `encryption` header.
 * @returns The answer.
 */
export function exchangeAnswer(
  data: JsonUnknownRecord,
  headers: readonly JsonUnknownRecord[] = [keyExchangeHeader()],
  encryption: JsonUnknownRecord = {},
): JsonUnknownRecord {
  const base = { type: 'encryption', iv: ENVELOPE_IV_TEXT, crypto_session_id: ENVELOPE_SESSION_ID };
  const key = peerKey();
  const sealed = sealUnder(key, data);
  return { headers: [...headers, { ...base, ...encryption }], data: sealed };
}
