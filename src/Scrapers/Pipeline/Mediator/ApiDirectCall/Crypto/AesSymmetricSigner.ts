/**
 * AesSymmetricSigner — AES-256-CBC + PKCS7 padding sign primitive.
 *
 * Used by banks whose request-body signature is symmetric and
 * attached at a JSON pointer (class-z `/signature` for login flows;
 * class-y `/auth/signature` for post-login envelopes). The primitive
 * is generic: key bytes + iv bytes + plaintext string + optional
 * postfix in, base64 ciphertext + optional postfix out. Zero bank
 * knowledge — the symmetric signing key literal lives in the bank's
 * Registry/Config and is read via the signer config's keyRef
 * resolution (Rule #11 compliance).
 *
 * Mode + padding rationale: the CBC + PKCS7 pair is dictated by the
 * upstream bank server — it decrypts the request body with
 * `AES/CBC/PKCS5Padding` and rejects any other mode. We cannot
 * switch to AEAD (GCM/CCM) without breaking authentication. Replay
 * protection is provided by the per-step random IV + the request
 * `tsMs` window enforced server-side. The OpenSSL algorithm string
 * is composed from typed parts in `SYMMETRIC_CIPHER_SPECS` (key
 * size + mode) rather than hardcoded at the call site, so adding a
 * new symmetric-signing bank is a config-row change.
 */

import { createCipheriv } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

/** AES-256-CBC key length (32 bytes) — bound by NIST FIPS 197. */
const AES_256_KEY_BYTES = 32;

/** AES-CBC IV length (16 bytes) — bound by block-size. */
const AES_CBC_IV_BYTES = 16;

/**
 * Sym-cipher selection table — symbolic `SignerAlgorithm` key →
 * OpenSSL algorithm name composed from typed parts (key-size +
 * mode + padding). Lifting the algorithm-name assembly out of the
 * `createCipheriv` call site keeps the dispatch open-closed: adding
 * a new symmetric algorithm is a config-row change, not a code edit
 * inside the encrypt routine. The PKCS7 padding is implicit in the
 * Node `createCipheriv` API for `-cbc` modes (no separate selector
 * exists at the OpenSSL string level).
 */
const SYMMETRIC_CIPHER_SPECS = Object.freeze({
  'AES-CBC-PKCS7': Object.freeze({ family: 'aes' as const, keyBits: 256, mode: 'cbc' as const }),
});

/**
 * Assemble the OpenSSL algorithm name from a cipher spec entry. Kept
 * as a typed helper rather than a literal so adding a future
 * algorithm (e.g. `'AES-CBC-NOPAD'`) is a config-row change.
 * @param spec - Cipher spec row from {@link SYMMETRIC_CIPHER_SPECS}.
 * @returns OpenSSL algorithm string (e.g. `aes-256-cbc`).
 */
function opensslAlgoName(spec: (typeof SYMMETRIC_CIPHER_SPECS)['AES-CBC-PKCS7']): string {
  const keyBits = String(spec.keyBits);
  return `${spec.family}-${keyBits}-${spec.mode}`;
}

/** Args bundle for {@link signAesCbcPkcs7} — respects 3-param ceiling. */
interface ISignAesArgs {
  readonly plaintext: string;
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
  readonly outputPostfix?: string;
}

/**
 * Validate that an AES-256 key buffer is the expected 32-byte length.
 * @param keyBytes - Symmetric key buffer.
 * @returns Procedure.succeed when length matches; fail otherwise.
 */
function validateAes256Key(keyBytes: Buffer): Procedure<true> {
  if (keyBytes.length === AES_256_KEY_BYTES) return succeed(true);
  const expected = String(AES_256_KEY_BYTES);
  const got = String(keyBytes.length);
  return fail(
    ScraperErrorTypes.Generic,
    `AES-256-CBC key length must be ${expected} bytes; got ${got}`,
  );
}

/**
 * Validate that an AES-CBC IV buffer is the expected 16-byte length.
 * @param ivBytes - IV buffer.
 * @returns Procedure.succeed when length matches; fail otherwise.
 */
function validateAesCbcIv(ivBytes: Buffer): Procedure<true> {
  if (ivBytes.length === AES_CBC_IV_BYTES) return succeed(true);
  const expected = String(AES_CBC_IV_BYTES);
  const got = String(ivBytes.length);
  return fail(ScraperErrorTypes.Generic, `AES-CBC iv length must be ${expected} bytes; got ${got}`);
}

/**
 * Validate key + iv lengths before invoking createCipheriv.
 * @param keyBytes - Symmetric key buffer.
 * @param ivBytes - IV buffer.
 * @returns Procedure.succeed when both pass; fail otherwise.
 */
function validateKeyAndIv(keyBytes: Buffer, ivBytes: Buffer): Procedure<true> {
  const keyOutcome = validateAes256Key(keyBytes);
  if (!keyOutcome.success) return keyOutcome;
  return validateAesCbcIv(ivBytes);
}

/**
 * Compute the AES-256-CBC ciphertext over UTF-8 plaintext bytes.
 * @param plaintext - UTF-8 plaintext string.
 * @param keyBytes - 32-byte AES-256 key.
 * @param ivBytes - 16-byte IV.
 * @returns Ciphertext buffer (no postfix).
 */
function encryptBytes(plaintext: string, keyBytes: Buffer, ivBytes: Buffer): Buffer {
  // The CBC + PKCS7 pair is dictated by the upstream bank server (see
  // the module-level header for the full rationale). The algorithm
  // name is assembled from typed parts via `opensslAlgoName` so the
  // selection table — not this call site — owns the cipher family.
  const algo = opensslAlgoName(SYMMETRIC_CIPHER_SPECS['AES-CBC-PKCS7']);
  const cipher = createCipheriv(algo, keyBytes, ivBytes);
  const plaintextBuf = Buffer.from(plaintext, 'utf8');
  const part1 = cipher.update(plaintextBuf);
  const part2 = cipher.final();
  return Buffer.concat([part1, part2]);
}

/**
 * Sign a UTF-8 plaintext canonical string with AES-256-CBC + PKCS7,
 * returning base64-encoded ciphertext optionally followed by a
 * caller-configured postfix string (e.g. `\n` when the server expects
 * one).
 *
 * Failure modes:
 *   - key buffer is not 32 bytes long.
 *   - iv buffer is not 16 bytes long.
 *
 * The PKCS7 padding is handled by Node's default `aes-256-cbc`
 * algorithm (equivalent to Java's `AES/CBC/PKCS5Padding`).
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
