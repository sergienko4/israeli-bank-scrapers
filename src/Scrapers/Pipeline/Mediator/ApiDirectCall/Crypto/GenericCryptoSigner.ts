/**
 * GenericCryptoSigner — signs pre-built canonical bytes with a
 * configured algorithm/encoding and assembles the outbound header
 * value: `data:<b64>;key-id:<hex>;scheme:<schemeTag>`. Carries zero
 * bank knowledge.
 */

import { createSign } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { ISignerConfig, SignerEncoding } from '../IApiDirectCallConfig.js';
import type { IGenericKeypair } from './CryptoKeyFactory.js';

/** Header value the caller attaches under config.headerName. */
type SignatureHeaderValue = string;

/** Base64-encoded signature bytes. */
type SignatureBase64 = string;

/** Lookup table — Partial wrapper makes lookups safely undefined-able at runtime. */
const DSA_ENCODING_MAP: Readonly<Partial<Record<SignerEncoding, 'der' | 'ieee-p1363'>>> = {
  DER: 'der',
  JOSE: 'ieee-p1363',
};

/**
 * Map a SignerEncoding tag onto Node's `dsaEncoding` option used by
 * createSign.sign.
 * @param encoding - Tag from ISignerConfig.encoding.
 * @returns Node DSA encoding name, or fail when unsupported.
 */
function dsaEncodingFor(encoding: SignerEncoding): Procedure<'der' | 'ieee-p1363'> {
  const mapped = DSA_ENCODING_MAP[encoding];
  if (mapped === undefined) {
    return fail(ScraperErrorTypes.Generic, `unsupported signer encoding: ${encoding as string}`);
  }
  return succeed(mapped);
}

/**
 * Run SHA-256 sign over the canonical bytes with the configured
 * encoding, returning base64 of the signature.
 * @param bytes - Canonical bytes to sign.
 * @param keypair - IGenericKeypair carrying the private key.
 * @param encoding - DSA encoding tag from config.
 * @returns Procedure with base64 signature string.
 */
function signBytes(
  bytes: Buffer,
  keypair: IGenericKeypair,
  encoding: SignerEncoding,
): Procedure<SignatureBase64> {
  const dsaEnc = dsaEncodingFor(encoding);
  if (!dsaEnc.success) return dsaEnc;
  const signer = createSign('SHA256');
  signer.update(bytes);
  const sig = signer.sign({ key: keypair.privateKey, dsaEncoding: dsaEnc.value });
  const sigBase64 = sig.toString('base64');
  return succeed(sigBase64);
}

/**
 * Sign canonical bytes and assemble the full header value.
 * @param bytes - Canonical bytes the caller already built (sortQuery,
 *   escape, etc. handled upstream).
 * @param keypair - IGenericKeypair carrying private key + key-id.
 * @param config - ISignerConfig (algorithm/encoding/headerName/schemeTag).
 * @returns Procedure with the assembled header value.
 */
function signCanonical(
  bytes: Buffer,
  keypair: IGenericKeypair,
  config: ISignerConfig,
): Procedure<SignatureHeaderValue> {
  const sigB64 = signBytes(bytes, keypair, config.encoding);
  if (!sigB64.success) return sigB64;
  const schemeStr = String(config.schemeTag);
  const value = `data:${sigB64.value};key-id:${keypair.keyIdHex};scheme:${schemeStr}`;
  return succeed(value);
}

export type { SignatureBase64, SignatureHeaderValue };
export default signCanonical;
export { signCanonical };
