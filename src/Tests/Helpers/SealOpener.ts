/**
 * Test-side opener for the `rsa-pkcs1-block-xor` (N10) and `rsa-pkcs1-v15`
 * (N44) seals. Node refuses PKCS#1 v1.5 private decryption, so each RSA
 * block is decrypted raw and its type-2 padding stripped by hand; a
 * block-xor tail is then un-XORed with the seed. Mocked bank servers and
 * unit tests share it to read what a step sealed.
 */

import type { KeyObject } from 'node:crypto';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';

import type { ISealRsaBlockXorParams } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** A synthetic RSA key: the private half and the public modulus as hex. */
export interface ISealKey {
  readonly privateKey: KeyObject;
  readonly modulusHex: string;
}

/** A synthetic RSA key for the `rsa-pkcs1-v15` seal, in both key-text forms. */
export interface IPkcs1Key {
  readonly privateKey: KeyObject;
  /** The public half as a PEM SPKI text. */
  readonly pem: string;
  /** The public half as base64 SPKI DER. */
  readonly derBase64: string;
}

/** What a sealed value holds once opened. */
export interface IOpenedSeal {
  /** Each RSA block's plaintext, in order. */
  readonly blocks: readonly string[];
  /** The seed drawn for this seal (the blocks joined, prefix removed). */
  readonly seed: string;
  /** The percent-encoded XOR tail, as sent. */
  readonly tail: string;
  /** The sealed source, recovered from the tail. */
  readonly source: string;
}

/** The seal constants a Hapoalim-style client uses. */
export const SEAL_PARAMS: ISealRsaBlockXorParams = {
  exponent: 65537,
  seedAlphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz',
  seedLength: 12,
  blockChars: 7,
  prefix: '[ENC]',
  blockSeparator: '|!|',
  envelopeTerminator: '|(!)|',
};

/**
 * Generate a synthetic RSA key for a seal test.
 * @param modulusLength - Key size in bits.
 * @returns The private key and the public modulus as hex.
 */
export function makeSealKey(modulusLength = 1024): ISealKey {
  const pair = generateKeyPairSync('rsa', { modulusLength });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const modulus = Buffer.from(jwk.n ?? '', 'base64url');
  const modulusHex = modulus.toString('hex');
  return { privateKey: pair.privateKey, modulusHex };
}

/**
 * Generate a synthetic RSA key for an `rsa-pkcs1-v15` seal test.
 * @param modulusLength - Key size in bits.
 * @returns The private key and the public half as PEM and base64 DER.
 */
export function makePkcs1Key(modulusLength = 1024): IPkcs1Key {
  const pair = generateKeyPairSync('rsa', { modulusLength });
  const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey: pair.privateKey, pem, derBase64: der.toString('base64') };
}

/**
 * Decrypt one RSA block and strip its PKCS#1 v1.5 type-2 padding.
 * @param privateKey - The seal key's private half.
 * @param cipher - One ciphertext block.
 * @returns The block's plaintext bytes.
 */
function unpadType2(privateKey: KeyObject, cipher: Buffer): Buffer {
  const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, cipher);
  if (padded[0] !== 0 || padded[1] !== 2) throw new TypeError('not a type-2 block');
  const zero = padded.indexOf(0, 2);
  if (zero < 10) throw new TypeError('type-2 padding too short');
  return padded.subarray(zero + 1);
}

/**
 * Decrypt one hex RSA block of a block-xor seal.
 * @param privateKey - The seal key's private half.
 * @param blockHex - One ciphertext block as hex.
 * @returns The block's ASCII plaintext.
 */
export function openBlock(privateKey: KeyObject, blockHex: string): string {
  const cipher = Buffer.from(blockHex, 'hex');
  return unpadType2(privateKey, cipher).toString('ascii');
}

/**
 * Open an `rsa-pkcs1-v15` seal.
 * @param privateKey - The seal key's private half.
 * @param sealed - The base64 value a step sent.
 * @returns The sealed source, read as latin1.
 */
export function openPkcs1(privateKey: KeyObject, sealed: string): string {
  const cipher = Buffer.from(sealed, 'base64');
  return unpadType2(privateKey, cipher).toString('latin1');
}

/**
 * Un-XOR a decoded tail with the seed, one UTF-16 unit at a time.
 * @param decoded - The tail after percent-decoding.
 * @param seed - The seal's seed.
 * @returns The sealed source.
 */
function unXor(decoded: string, seed: string): string {
  const codes = Array.from(
    { length: decoded.length },
    (_, index): number => decoded.charCodeAt(index) ^ seed.charCodeAt(index % seed.length),
  );
  return String.fromCharCode(...codes);
}

/**
 * Open a sealed value: decode base64url, decrypt each block, un-XOR the tail.
 * @param sealed - The value a step sent.
 * @param key - The synthetic key the seal used.
 * @param params - The seal constants.
 * @returns The opened seal.
 */
export function openSeal(sealed: string, key: ISealKey, params = SEAL_PARAMS): IOpenedSeal {
  const standard = sealed.replaceAll('-', '+').replaceAll('_', '/');
  const text = Buffer.from(standard, 'base64').toString('utf8');
  const [envelope, tail] = text.split(params.envelopeTerminator);
  const hexBlocks = envelope.split(params.blockSeparator);
  const blocks = hexBlocks.map((hex): string => openBlock(key.privateKey, hex));
  const seed = blocks.join('').slice(params.prefix.length);
  const decoded = decodeURIComponent(tail);
  return { blocks, seed, tail, source: unXor(decoded, seed) };
}
