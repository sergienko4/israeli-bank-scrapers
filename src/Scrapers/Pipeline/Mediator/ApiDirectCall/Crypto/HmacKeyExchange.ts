/**
 * HmacKeyExchange — generic key-exchange primitive that turns a
 * key-exchange response into the per-session HMAC key.
 *
 * Some bank clients bootstrap request signing with an unsigned
 * key-exchange call whose response carries an AES-CBC ciphertext + IV.
 * The client decrypts it with a key derived from a per-user seed (e.g.
 * a formatted phone number) plus a static salt, yielding a hex string
 * that IS the raw HMAC key bytes. This module is that decrypt + decode,
 * kept pure and bank-agnostic (Rule #11: zero bank-name strings): the
 * seed formatting, salt, and header names all live in the bank's
 * Registry/Config.
 *
 * Cipher: AES-256-CBC + PKCS7 (Node's default padding for `-cbc`),
 * matching the upstream server's `AES/CBC/PKCS5Padding`.
 */

import { createDecipheriv } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';

/** Raw HMAC-SHA256 key length produced by the exchange (32 bytes). */
const HMAC_KEY_BYTES = 32;

/** OpenSSL algorithm for the exchange ciphertext (AES-256-CBC + PKCS7). */
const EXCHANGE_CIPHER_ALGO = 'aes-256-cbc';

/** Exchange-key derivation inputs — options object (≤3-param ceiling). */
interface IDeriveExchangeKeyArgs {
  readonly seed: string;
  readonly salt: string;
  readonly length: number;
  readonly padChar: string;
}

/** Exchange-decrypt inputs — options object. */
interface IDecryptExchangeArgs {
  readonly ciphertextB64: string;
  readonly ivHex: string;
  readonly keyBytes: Buffer;
}

/**
 * Fit a string to an exact length: truncate when longer, right-pad
 * with `padChar` when shorter.
 * @param value - Source string.
 * @param length - Target length.
 * @param padChar - Single-character pad used when `value` is short.
 * @returns String of exactly `length` characters.
 */
function fitToLength(value: string, length: number, padChar: string): string {
  if (value.length >= length) return value.slice(0, length);
  return value.padEnd(length, padChar);
}

/**
 * Derive the AES key that decrypts the exchange ciphertext:
 * `fit(seed + salt, length)` as UTF-8 bytes.
 * @param args - Seed + salt + target length + pad char.
 * @returns Key buffer of `args.length` bytes.
 */
function deriveExchangeKey(args: IDeriveExchangeKeyArgs): Buffer {
  const combined = `${args.seed}${args.salt}`;
  const sized = fitToLength(combined, args.length, args.padChar);
  return Buffer.from(sized, 'utf8');
}

/**
 * Normalise a caught value to a message string.
 * @param err - Caught value.
 * @returns Human-readable message.
 */
function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * AES-256-CBC decrypt the exchange ciphertext to its UTF-8 plaintext.
 * @param args - Ciphertext (base64) + IV (hex) + key bytes.
 * @returns Decrypted UTF-8 plaintext (expected to be a hex string).
 */
function decryptToPlaintext(args: IDecryptExchangeArgs): string {
  const iv = Buffer.from(args.ivHex, 'hex');
  const ciphertext = Buffer.from(args.ciphertextB64, 'base64');
  const decipher = createDecipheriv(EXCHANGE_CIPHER_ALGO, args.keyBytes, iv);
  const head = decipher.update(ciphertext);
  const tail = decipher.final();
  const plaintext = Buffer.concat([head, tail]);
  return plaintext.toString('utf8');
}

/**
 * Decrypt guarded against bad padding / wrong key (an expected runtime
 * failure when the seed or salt is wrong).
 * @param args - Exchange-decrypt inputs.
 * @returns Procedure with the UTF-8 plaintext.
 */
function tryDecryptToPlaintext(args: IDecryptExchangeArgs): Procedure<string> {
  try {
    const plaintext = decryptToPlaintext(args);
    return succeed(plaintext);
  } catch (error) {
    return fail(ScraperErrorTypes.Generic, `key-exchange decrypt failed: ${toErrorMessage(error)}`);
  }
}

/**
 * Validate that the hex-decoded plaintext is a 32-byte HMAC key.
 * @param hmacKey - Candidate key bytes.
 * @returns Procedure with the key when valid; fail otherwise.
 */
function ensureHmacKeyLength(hmacKey: Buffer): Procedure<Buffer> {
  if (hmacKey.length === HMAC_KEY_BYTES) return succeed(hmacKey);
  const want = String(HMAC_KEY_BYTES);
  const got = String(hmacKey.length);
  return fail(ScraperErrorTypes.Generic, `exchanged HMAC key must be ${want} bytes; got ${got}`);
}

/**
 * Decrypt a key-exchange response into the raw 32-byte HMAC key. The
 * plaintext is a hex string; hex-decoding it yields the key bytes.
 * @param args - Ciphertext (base64) + IV (hex) + derived AES key bytes.
 * @returns Procedure with the 32-byte HMAC key.
 */
function decryptExchangedHmacKey(args: IDecryptExchangeArgs): Procedure<Buffer> {
  const plaintextProc = tryDecryptToPlaintext(args);
  if (!isOk(plaintextProc)) return plaintextProc;
  const hmacKey = Buffer.from(plaintextProc.value, 'hex');
  if (hmacKey.toString('hex') !== plaintextProc.value.toLowerCase()) {
    return fail(ScraperErrorTypes.Generic, 'exchanged HMAC key must be canonical hexadecimal');
  }
  return ensureHmacKeyLength(hmacKey);
}

export type { IDecryptExchangeArgs, IDeriveExchangeKeyArgs };
export { decryptExchangedHmacKey, deriveExchangeKey };
