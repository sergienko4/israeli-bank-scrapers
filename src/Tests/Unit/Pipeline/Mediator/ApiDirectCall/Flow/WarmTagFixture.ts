/**
 * Independent account-tag vectors for the warm-token codecs. The derivation
 * is repeated here deliberately: a codec test that calls the production tag
 * helper cannot catch a change to the KDF or HMAC step.
 */

import { createHash, createHmac, scryptSync } from 'node:crypto';

/** Tag characters the codecs publish. */
const TAG_CHARS = 16;

/**
 * The legacy unkeyed tag.
 * @param text - Identity text.
 * @returns The first 16 hex characters of its SHA-256.
 */
function legacyTag(text: string): string {
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return digest.slice(0, TAG_CHARS);
}

/**
 * Compute the keyed tag an envelope should carry.
 * @param text - Identity text.
 * @param key - Password or bank fallback.
 * @param salt - Per-token nonce.
 * @returns The first 16 hex characters of the keyed HMAC.
 */
function expectedTag(text: string, key: string, salt: string): string {
  const derived = scryptSync(key, salt, 32);
  const digest = createHmac('sha256', derived).update(text, 'utf8').digest('hex');
  return digest.slice(0, TAG_CHARS);
}

export { expectedTag, legacyTag };
