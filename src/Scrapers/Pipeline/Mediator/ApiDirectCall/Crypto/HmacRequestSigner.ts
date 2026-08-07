/**
 * HmacRequestSigner — generic per-request HMAC signature primitive.
 *
 * Some bank clients sign every authenticated API call with an HMAC over
 * a canonical request descriptor and carry the result in HTTP headers
 * (timestamp + nonce + signature). This module is that primitive:
 * canonical assembly + body hashing + HMAC — pure, deterministic, and
 * bank-agnostic (Rule #11: zero bank-name strings). The HMAC key bytes
 * are a session artifact supplied by the caller; header names live in
 * the bank's Registry/Config.
 *
 * Canonical shape (UTF-8):
 *   `METHOD:PATH:TIMESTAMP:NONCE:BODYHASH`
 * where METHOD is uppercase, PATH includes the leading `/` and the API
 * prefix but excludes query/fragment, and BODYHASH is
 * `Base64(SHA-256(outboundBodyBytes))` (empty body → the SHA-256 of the
 * empty byte array). The signature is `Base64(HMAC-SHA256(key, canonical))`
 * (Node's `digest('base64')` is unwrapped, matching Android's
 * `Base64.NO_WRAP`).
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';

/** HMAC-SHA256 key length used by the request-signature scheme (32 bytes). */
const HMAC_KEY_BYTES = 32;

/** Canonical-assembly inputs — options object (respects the 3-param ceiling). */
interface IHmacCanonicalArgs {
  readonly method: string;
  readonly path: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyHash: string;
}

/** Per-request signing inputs — options object. */
interface ISignRequestArgs {
  readonly method: string;
  readonly path: string;
  readonly bodyBytes: Buffer;
  readonly hmacKey: Buffer;
  readonly timestamp: string;
  readonly nonce: string;
}

/** Computed signature bundle returned by {@link signRequest}. */
interface ISignedRequest {
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyHash: string;
  readonly canonical: string;
  readonly signature: string;
}

/**
 * Base64 SHA-256 over the exact outbound body bytes. An empty buffer
 * yields the well-known empty-body digest
 * `47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`.
 * @param bodyBytes - The exact bytes placed on the wire.
 * @returns Base64-encoded SHA-256 digest.
 */
function hashBody(bodyBytes: Buffer): string {
  return createHash('sha256').update(bodyBytes).digest('base64');
}

/**
 * Assemble the canonical `METHOD:PATH:TS:NONCE:BODYHASH` string. METHOD
 * is uppercased here so callers may pass any case.
 * @param args - Canonical parts.
 * @returns The UTF-8 canonical string (not yet encoded).
 */
function buildHmacCanonical(args: IHmacCanonicalArgs): string {
  const method = args.method.toUpperCase();
  return `${method}:${args.path}:${args.timestamp}:${args.nonce}:${args.bodyHash}`;
}

/**
 * Validate that an HMAC key buffer is the expected 32-byte length.
 * @param keyBytes - HMAC key buffer.
 * @returns Procedure.succeed when length matches; fail otherwise.
 */
function validateHmacKey(keyBytes: Buffer): Procedure<true> {
  if (keyBytes.length === HMAC_KEY_BYTES) return succeed(true);
  const got = String(keyBytes.length);
  const want = String(HMAC_KEY_BYTES);
  return fail(ScraperErrorTypes.Generic, `HMAC key must be ${want} bytes; got ${got}`);
}

/**
 * Compute `Base64(HMAC-SHA256(key, canonical))` over the UTF-8 canonical.
 * @param keyBytes - 32-byte HMAC key.
 * @param canonical - Canonical request string.
 * @returns Procedure with the unwrapped base64 signature.
 */
function signCanonicalHmac(keyBytes: Buffer, canonical: string): Procedure<string> {
  const keyCheck = validateHmacKey(keyBytes);
  if (!isOk(keyCheck)) return keyCheck;
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  const digest = createHmac('sha256', keyBytes).update(canonicalBytes).digest('base64');
  return succeed(digest);
}

/**
 * Sign a single request: hash the body, assemble the canonical, and HMAC
 * it. The returned `timestamp`/`nonce` echo the inputs so the caller
 * places the identical values in both the headers and the canonical.
 * @param args - Method, path, body bytes, HMAC key, timestamp, nonce.
 * @returns Procedure with the signature bundle.
 */
function signRequest(args: ISignRequestArgs): Procedure<ISignedRequest> {
  const bodyHash = hashBody(args.bodyBytes);
  const canonical = buildHmacCanonical({ ...args, bodyHash });
  const sig = signCanonicalHmac(args.hmacKey, canonical);
  if (!isOk(sig)) return sig;
  const { timestamp, nonce } = args;
  return succeed({ timestamp, nonce, bodyHash, canonical, signature: sig.value });
}

/**
 * Mint a fresh lowercase, hyphenated UUID v4 nonce (`X-Nonce`).
 * @returns UUID v4 string.
 */
function mintNonce(): string {
  return randomUUID();
}

export type { IHmacCanonicalArgs, ISignedRequest, ISignRequestArgs };
export { buildHmacCanonical, hashBody, mintNonce, signCanonicalHmac, signRequest };
