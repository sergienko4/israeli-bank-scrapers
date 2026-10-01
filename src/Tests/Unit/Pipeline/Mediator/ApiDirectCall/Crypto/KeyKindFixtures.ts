/**
 * KeyKindFixtures — one keypair bundle per kind of key a caller could inject,
 * each tagged with the only algorithm it is sound for. The CryptoKeyFactory
 * and SmsOtpFlow injected-key suites run the same cases, so a rule one path
 * learns and the other misses fails a suite.
 *
 * Foreign kinds are built self-consistent (public half and key ID derived
 * from their own private key), so their rejection proves the key-shape check
 * on its own rather than a public-half mismatch.
 */

import type { KeyObject } from 'node:crypto';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { AsymmetricSignerAlgorithm } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/SignerTypes.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';

/** One injectable key kind and the algorithm it may sign as. */
interface IKeyKind {
  readonly label: string;
  readonly keypair: IGenericKeypair;
  /** The one algorithm this bundle is sound for, or false when it fits none. */
  readonly soundFor: AsymmetricSignerAlgorithm | false;
}

/**
 * Generate a keypair through the production generator.
 * @param algorithm - Algorithm to generate.
 * @returns Keypair bundle.
 */
function generated(algorithm: AsymmetricSignerAlgorithm): IGenericKeypair {
  const result = generateKeypair(algorithm);
  if (!result.success) throw new ScraperError(`${algorithm} generation should succeed`);
  return result.value;
}

/**
 * Build a self-consistent bundle for a key the generator cannot make. The key
 * ID follows the documented format: lowercase hex SHA-256 of the SPKI DER.
 * @param privateKey - Any Node private key.
 * @returns Bundle whose public half and key ID derive from the private key.
 */
function selfConsistent(privateKey: KeyObject): IGenericKeypair {
  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const keyIdHex = createHash('sha256').update(publicKeyDer).digest('hex');
  return { privateKey, publicKeyDer, publicKeyBase64: publicKeyDer.toString('base64'), keyIdHex };
}

const P256 = generated('ECDSA-P256');
const P256_OTHER = generated('ECDSA-P256');
const RSA2048 = generated('RSA-2048');
const RSA2048_OTHER = generated('RSA-2048');

/** Every key kind the injected-key suites run, sound and foreign. */
const KEY_KINDS: readonly IKeyKind[] = [
  { label: 'P-256', keypair: P256, soundFor: 'ECDSA-P256' },
  { label: 'RSA-2048', keypair: RSA2048, soundFor: 'RSA-2048' },
  {
    label: 'P-384',
    keypair: selfConsistent(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey),
    soundFor: false,
  },
  {
    label: 'secp256k1',
    keypair: selfConsistent(generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey),
    soundFor: false,
  },
  {
    label: 'RSA-1024',
    keypair: selfConsistent(generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey),
    soundFor: false,
  },
  {
    label: 'Ed25519',
    keypair: selfConsistent(generateKeyPairSync('ed25519').privateKey),
    soundFor: false,
  },
  {
    label: 'P-256 with a public key in the private slot',
    keypair: { ...P256, privateKey: createPublicKey(P256.privateKey) },
    soundFor: false,
  },
  {
    label: "P-256 with another key's public half",
    keypair: { ...P256_OTHER, privateKey: P256.privateKey },
    soundFor: false,
  },
  {
    label: "P-256 with another key's key ID",
    keypair: { ...P256, keyIdHex: P256_OTHER.keyIdHex },
    soundFor: false,
  },
  {
    label: "P-256 with another key's public Base64",
    keypair: { ...P256, publicKeyBase64: P256_OTHER.publicKeyBase64 },
    soundFor: false,
  },
  {
    label: "RSA-2048 with another key's SPKI",
    keypair: { ...RSA2048, publicKeyDer: RSA2048_OTHER.publicKeyDer },
    soundFor: false,
  },
];

export type { IKeyKind };
export { KEY_KINDS };
