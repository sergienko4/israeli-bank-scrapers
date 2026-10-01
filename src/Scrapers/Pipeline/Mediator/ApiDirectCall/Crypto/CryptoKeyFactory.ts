/**
 * CryptoKeyFactory — generic asymmetric-keypair generator dispatched
 * by SignerAlgorithm tag. Returns a uniform keypair bundle that
 * GenericCryptoSigner consumes; carries zero bank knowledge.
 *
 * Pure Node stdlib crypto — no third-party deps.
 */

import type { KeyObject } from 'node:crypto';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { SignerAlgorithm } from '../ConfigContracts/index.js';

/** Uniform keypair bundle returned for every supported algorithm. */
interface IGenericKeypair {
  readonly privateKey: KeyObject;
  readonly publicKeyDer: Buffer;
  readonly publicKeyBase64: string;
  readonly keyIdHex: string;
}

/**
 * SHA-256 over a public key DER, returned as lowercase hex.
 * @param publicKeyDer - SubjectPublicKeyInfo DER bytes.
 * @returns 64-char lowercase hex string.
 */
function keyIdOf(publicKeyDer: Buffer): string {
  const hash = createHash('sha256');
  const updated = hash.update(publicKeyDer);
  return updated.digest('hex');
}

/**
 * Wrap a Node KeyObject pair into the IGenericKeypair bundle.
 * @param privateKey - Node private KeyObject.
 * @param publicKey - Node public KeyObject.
 * @returns IGenericKeypair.
 */
function packKeypair(privateKey: KeyObject, publicKey: KeyObject): IGenericKeypair {
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBase64 = publicKeyDer.toString('base64');
  const keyIdHex = keyIdOf(publicKeyDer);
  return { privateKey, publicKeyDer, publicKeyBase64, keyIdHex };
}

/**
 * Generate a fresh ECDSA P-256 keypair.
 * @returns IGenericKeypair Procedure.
 */
function generateEcP256(): Procedure<IGenericKeypair> {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const bundle = packKeypair(pair.privateKey, pair.publicKey);
  return succeed(bundle);
}

/**
 * Generate a fresh RSA 2048-bit keypair.
 * @returns IGenericKeypair Procedure.
 */
function generateRsa2048(): Procedure<IGenericKeypair> {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const bundle = packKeypair(pair.privateKey, pair.publicKey);
  return succeed(bundle);
}

/** Lookup-table value type for the keypair-generator dispatch map. */
type KeypairFactory = () => Procedure<IGenericKeypair>;

/** Dispatch table — Partial wrapper makes lookups safely undefined-able. */
const KEYPAIR_GENERATORS: Readonly<Partial<Record<SignerAlgorithm, KeypairFactory>>> = {
  'ECDSA-P256': generateEcP256,
  'RSA-2048': generateRsa2048,
};

/**
 * Dispatch keypair generation by configured SignerAlgorithm.
 * @param algorithm - Tag from ISignerConfig.algorithm.
 * @returns Procedure with the keypair, or unsupported-algorithm failure.
 */
function generateKeypair(algorithm: SignerAlgorithm): Procedure<IGenericKeypair> {
  const factory = KEYPAIR_GENERATORS[algorithm];
  if (factory === undefined) {
    return fail(ScraperErrorTypes.Generic, `unsupported signer algorithm: ${algorithm as string}`);
  }
  return factory();
}

/** Node's name for the P-256 curve in `asymmetricKeyDetails.namedCurve`. */
const P256_CURVE_NAME = 'prime256v1';

/**
 * Parse PKCS#8 DER into a private KeyObject without throwing.
 * @param der - PKCS#8 DER bytes.
 * @returns The private key, or false when the bytes are not a PKCS#8 key.
 */
function tryParsePkcs8(der: Buffer): KeyObject | false {
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    return false;
  }
}

/**
 * Parse canonical Base64 PKCS#8 text into a P-256 private key.
 * @param pkcs8Base64 - PKCS#8 DER encoded as standard padded Base64.
 * @returns The private key, or false for any other text, key type, or curve.
 */
function parseCanonicalEcP256(pkcs8Base64: string): KeyObject | false {
  const der = Buffer.from(pkcs8Base64, 'base64');
  if (der.length === 0 || der.toString('base64') !== pkcs8Base64) return false;
  const privateKey = tryParsePkcs8(der);
  if (privateKey === false) return false;
  if (privateKey.asymmetricKeyDetails?.namedCurve !== P256_CURVE_NAME) return false;
  return privateKey;
}

/**
 * Rehydrate a persisted ECDSA P-256 private key and derive its public half,
 * SPKI, and key ID through the same {@link packKeypair} path that generation
 * uses. Non-canonical Base64, non-PKCS#8 bytes, and any other key type or
 * curve are rejected; the failure text never includes key material.
 * @param pkcs8Base64 - PKCS#8 DER encoded as standard padded Base64.
 * @returns Keypair bundle, or a failure naming only the key category.
 */
function importEcP256Pkcs8(pkcs8Base64: string): Procedure<IGenericKeypair> {
  const privateKey = parseCanonicalEcP256(pkcs8Base64);
  if (privateKey === false) return fail(ScraperErrorTypes.Generic, 'persisted EC key invalid');
  const publicKey = createPublicKey(privateKey);
  const bundle = packKeypair(privateKey, publicKey);
  return succeed(bundle);
}

/**
 * Export a keypair's private key as PKCS#8 DER in standard Base64 — the
 * inverse of {@link importEcP256Pkcs8}.
 * @param keypair - Keypair bundle to persist.
 * @returns PKCS#8 DER as standard padded Base64.
 */
function exportPkcs8Base64(keypair: IGenericKeypair): string {
  const der = keypair.privateKey.export({ type: 'pkcs8', format: 'der' });
  return der.toString('base64');
}

export type { IGenericKeypair };
export default generateKeypair;
export { exportPkcs8Base64, generateKeypair, importEcP256Pkcs8 };
