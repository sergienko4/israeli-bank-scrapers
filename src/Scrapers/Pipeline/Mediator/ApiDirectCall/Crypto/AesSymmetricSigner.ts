/**
 * AesSymmetricSigner — AES-256-CBC + PKCS7 padding sign primitive.
 *
 * Used by banks whose request-body signature is symmetric and
 * attached at a JSON pointer. The primitive is generic: key bytes
 * + iv bytes + plaintext string + optional postfix in, base64
 * ciphertext + optional postfix out. Zero bank knowledge.
 *
 * Rule #11: this file carries no bank-specific symbols. The
 * symmetric signing key literal lives in the bank's Registry/Config
 * and is read via the signer config's `keyRef` resolution.
 */

import { createCipheriv } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

/** AES-256-CBC key length (32 bytes) — bound by NIST FIPS 197. */
const AES_256_KEY_BYTES = 32;

/** AES-CBC IV length (16 bytes) — bound by block-size. */
const AES_CBC_IV_BYTES = 16;

/** Args bundle for {@link signAesCbcPkcs7} — respects 3-param ceiling. */
interface ISignAesArgs {
  readonly plaintext: string;
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
  readonly outputPostfix?: string;
}

/**
 * Validate key and iv lengths before invoking createCipheriv.
 * @param keyBytes - Symmetric key buffer.
 * @param ivBytes - IV buffer.
 * @returns Procedure.succeed when both pass; fail otherwise.
 */
function validateKeyAndIv(keyBytes: Buffer, ivBytes: Buffer): Procedure<true> {
  if (keyBytes.length !== AES_256_KEY_BYTES) {
    const expected = String(AES_256_KEY_BYTES);
    const got = String(keyBytes.length);
    return fail(
      ScraperErrorTypes.Generic,
      `AES-256-CBC key length must be ${expected} bytes; got ${got}`,
    );
  }
  if (ivBytes.length !== AES_CBC_IV_BYTES) {
    const expected = String(AES_CBC_IV_BYTES);
    const got = String(ivBytes.length);
    return fail(
      ScraperErrorTypes.Generic,
      `AES-CBC iv length must be ${expected} bytes; got ${got}`,
    );
  }
  return succeed(true);
}

/**
 * Compute the AES-256-CBC ciphertext over UTF-8 plaintext bytes.
 * @param plaintext - UTF-8 plaintext string.
 * @param keyBytes - 32-byte AES-256 key.
 * @param ivBytes - 16-byte IV.
 * @returns Ciphertext buffer (no postfix).
 */
function encryptBytes(plaintext: string, keyBytes: Buffer, ivBytes: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-cbc', keyBytes, ivBytes);
  const plaintextBuf = Buffer.from(plaintext, 'utf8');
  const part1 = cipher.update(plaintextBuf);
  const part2 = cipher.final();
  return Buffer.concat([part1, part2]);
}

/**
 * Sign a UTF-8 plaintext canonical string with AES-256-CBC + PKCS7,
 * returning base64-encoded ciphertext optionally followed by a
 * caller-configured postfix string (e.g. "\n" when the server expects one).
 *
 * Failure modes:
 *   - key buffer is not 32 bytes long (Procedure.fail).
 *   - iv buffer is not 16 bytes long (Procedure.fail).
 *
 * The PKCS7 padding is handled by Node's default `aes-256-cbc` algorithm
 * (equivalent to Java's `AES/CBC/PKCS5Padding`).
 * @param args - plaintext + keyBytes + ivBytes + optional outputPostfix.
 * @returns Procedure with `base64(ciphertext) + outputPostfix`.
 */
function signAesCbcPkcs7(args: ISignAesArgs): Procedure<string> {
  const validation = validateKeyAndIv(args.keyBytes, args.ivBytes);
  if (!validation.success) return validation;
  const ciphertext = encryptBytes(args.plaintext, args.keyBytes, args.ivBytes);
  const base64 = ciphertext.toString('base64');
  const postfix = args.outputPostfix ?? '';
  return succeed(`${base64}${postfix}`);
}

export type { ISignAesArgs };
export { signAesCbcPkcs7 };
