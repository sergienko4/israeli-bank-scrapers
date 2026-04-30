/**
 * CryptoKeyFactory — generic asymmetric-keypair generator dispatched
 * by SignerAlgorithm tag. Returns a uniform keypair bundle that
 * GenericCryptoSigner consumes; carries zero bank knowledge.
 *
 * Pure Node stdlib crypto — no third-party deps.
 */

import type { KeyObject } from 'node:crypto';
import { createHash, generateKeyPairSync } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { SignerAlgorithm } from '../IApiDirectCallConfig.js';

/** Lowercase-hex SHA-256 digest used as the universal key-id. */
type KeyIdHex = string;

/** Uniform keypair bundle returned for every supported algorithm. */
interface IGenericKeypair {
  readonly privateKey: KeyObject;
  readonly publicKeyDer: Buffer;
  readonly publicKeyBase64: string;
  readonly keyIdHex: KeyIdHex;
}

/**
 * SHA-256 over a public key DER, returned as lowercase hex.
 * @param publicKeyDer - SubjectPublicKeyInfo DER bytes.
 * @returns 64-char lowercase hex string.
 */
function keyIdOf(publicKeyDer: Buffer): KeyIdHex {
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

export type { IGenericKeypair, KeyIdHex };
export default generateKeypair;
export { generateKeypair };
