/**
 * IV byte-length constants + fresh random IV-hex generator.
 */

import { randomBytes } from 'node:crypto';

/** IV byte length for AES-CBC (matches block size). */
const IV_BYTES = 16;

/** AES-256 key byte length used by the symmetric signer. */
const AES_KEY_BYTES = 32;

/**
 * Generate a fresh 16-byte IV expressed as 32-char lowercase hex.
 * @returns Random IV hex string.
 */
function freshIvHex(): string {
  const bytes = randomBytes(IV_BYTES);
  return bytes.toString('hex');
}

export default freshIvHex;

export { AES_KEY_BYTES, freshIvHex, IV_BYTES };
