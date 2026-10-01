/**
 * Independent verifier for Pepper's signed Transmit requests.
 *
 * Rebuilt from the protocol description, not from the production builder, so
 * a production regression cannot also bend the oracle:
 *
 *   escape(pathname + "?" + sortedQuery) + "%%" +
 *   escape(X-TS-Client-Version) + "%%" + escape(bodyText)
 *
 * where `escape` turns each literal `%%` into `\%`. The signature is checked
 * with `crypto.verify` (ECDSA P-256 / SHA-256, DER); ECDSA output is
 * randomised, so bytes are never compared. Rule #18: no real key material.
 */

import { createHash, createPublicKey, verify } from 'node:crypto';

/** One request exactly as the transport sent it. */
interface ISignedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

/** Parsed `Content-Signature` header fields. */
interface ISignatureHeader {
  readonly data: string;
  readonly keyId: string;
  readonly scheme: string;
}

const SIGNATURE_PATTERN = /^data:([^;]+);key-id:([0-9a-f]+);scheme:(\d+)$/;

/**
 * Read a header case-insensitively, as an HTTP server would.
 * @param headers - Request headers.
 * @param name - Header name.
 * @returns Header value, or '' when absent.
 */
function headerOf(headers: Readonly<Record<string, string>>, name: string): string {
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((candidate): boolean => {
    return candidate.toLowerCase() === lower;
  });
  if (key === undefined) return '';
  return headers[key];
}

/**
 * Escape a canonical segment: each literal `%%` becomes `\%`.
 * @param value - Segment text.
 * @returns Escaped segment.
 */
function escapeSegment(value: string): string {
  return value.split('%%').join('\\%');
}

/**
 * Rebuild the canonical string the client must have signed.
 * @param request - Request as received.
 * @returns Canonical string.
 */
function canonicalOf(request: ISignedRequest): string {
  const parsed = new URL(request.url);
  const components = parsed.search.slice(1).split('&');
  const sortedQuery = [...components].sort().join('&');
  const pathAndQuery = `${parsed.pathname}?${sortedQuery}`;
  const clientVersion = headerOf(request.headers, 'X-TS-Client-Version');
  const segments = [pathAndQuery, clientVersion, request.bodyText];
  return segments.map(escapeSegment).join('%%');
}

/**
 * Parse the `Content-Signature` header.
 * @param request - Request as received.
 * @returns Parsed fields, or false when absent/malformed.
 */
function signatureOf(request: ISignedRequest): ISignatureHeader | false {
  const raw = headerOf(request.headers, 'Content-Signature');
  const match = SIGNATURE_PATTERN.exec(raw);
  if (match === null) return false;
  return { data: match[1], keyId: match[2], scheme: match[3] };
}

/**
 * Lower-case SHA-256 hex over a SPKI DER public key.
 * @param publicKeyDer - SPKI DER bytes.
 * @returns Key identifier.
 */
function keyIdOf(publicKeyDer: Buffer): string {
  return createHash('sha256').update(publicKeyDer).digest('hex');
}

/**
 * Verify the request signature against a registered SPKI DER public key.
 * @param request - Request as received.
 * @param publicKeyDer - Registered SPKI DER public key.
 * @returns True only when key-id, scheme and ECDSA signature all match.
 */
function isValidSignature(request: ISignedRequest, publicKeyDer: Buffer): boolean {
  const header = signatureOf(request);
  if (header === false || header.scheme !== '4') return false;
  const expectedKeyId = keyIdOf(publicKeyDer);
  if (header.keyId !== expectedKeyId) return false;
  const key = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  const canonicalText = canonicalOf(request);
  const canonical = Buffer.from(canonicalText, 'utf8');
  const signature = Buffer.from(header.data, 'base64');
  return verify('sha256', canonical, { key, dsaEncoding: 'der' }, signature);
}

export type { ISignedRequest };
export { canonicalOf, headerOf, isValidSignature, keyIdOf };
