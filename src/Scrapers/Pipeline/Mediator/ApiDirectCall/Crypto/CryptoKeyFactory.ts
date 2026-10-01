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
import type { AsymmetricSignerAlgorithm } from '../ConfigContracts/SignerTypes.js';

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

/** Node key details a private key needs to sign as one asymmetric algorithm. */
interface IKeyShape {
  readonly keyType: 'ec' | 'rsa';
  readonly namedCurve?: string;
  readonly modulusLength?: number;
}

/** Required shape per algorithm; a field absent here must be absent on the key. */
const KEY_SHAPE_BY_ALGORITHM: Readonly<Record<AsymmetricSignerAlgorithm, IKeyShape>> = {
  'ECDSA-P256': { keyType: 'ec', namedCurve: P256_CURVE_NAME },
  'RSA-2048': { keyType: 'rsa', modulusLength: 2048 },
};

/**
 * Check that a key is a private key of the algorithm's type, curve, and size.
 * @param key - Any Node key object.
 * @param algorithm - Asymmetric algorithm the key must sign as.
 * @returns True only for a matching private key.
 */
function hasKeyShape(key: KeyObject, algorithm: AsymmetricSignerAlgorithm): boolean {
  const shape = KEY_SHAPE_BY_ALGORITHM[algorithm];
  if (key.type !== 'private' || key.asymmetricKeyType !== shape.keyType) return false;
  const details = key.asymmetricKeyDetails ?? {};
  return details.namedCurve === shape.namedCurve && details.modulusLength === shape.modulusLength;
}

/**
 * Check a keypair built outside the generator: its private key must have the
 * algorithm's shape, and its public key, SPKI, and key ID must derive from that
 * key, so the signature, published key, and key ID never disagree.
 * @param keypair - Keypair bundle from a caller.
 * @param algorithm - Asymmetric algorithm the keypair must sign as.
 * @returns True when the bundle is safe to sign with as that algorithm.
 */
function isKeypairFor(keypair: IGenericKeypair, algorithm: AsymmetricSignerAlgorithm): boolean {
  if (!hasKeyShape(keypair.privateKey, algorithm)) return false;
  const publicKey = createPublicKey(keypair.privateKey);
  const derived = packKeypair(keypair.privateKey, publicKey);
  if (derived.keyIdHex !== keypair.keyIdHex) return false;
  if (derived.publicKeyBase64 !== keypair.publicKeyBase64) return false;
  return derived.publicKeyDer.equals(keypair.publicKeyDer);
}

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
  if (!hasKeyShape(privateKey, 'ECDSA-P256')) return false;
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
 * Export a P-256 keypair's private key as PKCS#8 DER in standard Base64 — the
 * inverse of {@link importEcP256Pkcs8}. Only a bundle {@link isKeypairFor}
 * accepts as ECDSA-P256 is written, so everything exported imports back as
 * the same public key and key ID; the failure text never includes key material.
 * @param keypair - Keypair bundle to persist.
 * @returns PKCS#8 DER as standard padded Base64, or a failure naming only the key category.
 */
function exportEcP256Pkcs8(keypair: IGenericKeypair): Procedure<string> {
  if (!isKeypairFor(keypair, 'ECDSA-P256')) {
    return fail(ScraperErrorTypes.Generic, 'EC key export invalid');
  }
  const der = keypair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const pkcs8Base64 = der.toString('base64');
  return succeed(pkcs8Base64);
}

export type { IGenericKeypair };
export default generateKeypair;
export { exportEcP256Pkcs8, generateKeypair, importEcP256Pkcs8, isKeypairFor };
