/**
 * Request-body digest header value:
 * `encode(ascii(prefix + hash(bodyBytes)))`. The hash and the encoding are
 * picked from maps keyed by the config, so a new kind is a new entry.
 */

import { createHash } from 'node:crypto';

import type { IBodyDigestConfig } from '../ConfigContracts/SignerTypes.js';

/** Hashes a body's bytes to text. */
type DigestHasher = (bytes: Buffer) => string;

/** Encodes the prefixed hash text to the header value. */
type DigestEncoder = (text: string) => string;

/**
 * SHA-256 of the bytes as lower-case hex.
 * @param bytes - Body bytes.
 * @returns Hex digest.
 */
function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Base64 of the text's ASCII bytes.
 * @param text - Prefixed hash text.
 * @returns Base64 text.
 */
function asciiBase64(text: string): string {
  return Buffer.from(text, 'ascii').toString('base64');
}

/** Hasher per configured hash kind. */
const DIGEST_HASHERS: Readonly<Record<IBodyDigestConfig['hash'], DigestHasher>> = {
  'sha256-hex': sha256Hex,
};

/** Encoder per configured encoding. */
const DIGEST_ENCODERS: Readonly<Record<IBodyDigestConfig['encode'], DigestEncoder>> = {
  base64: asciiBase64,
};

/**
 * Compute the digest header value for a body's bytes.
 * @param bytes - The exact body bytes sent.
 * @param digest - Digest config (prefix, hash, encoding).
 * @returns Header value.
 */
function computeBodyDigest(bytes: Buffer, digest: IBodyDigestConfig): string {
  const hashed = DIGEST_HASHERS[digest.hash](bytes);
  return DIGEST_ENCODERS[digest.encode](`${digest.prefix}${hashed}`);
}

export default computeBodyDigest;
export { computeBodyDigest };
