/**
 * SealRsaBlockXor — the `rsa-pkcs1-block-xor` credential seal (N10). A fresh
 * seed, behind a fixed prefix, is RSA-PKCS#1 v1.5 encrypted in short ASCII
 * blocks under the bank's public modulus: hex ciphertexts joined by a
 * separator, then a terminator. The seed-XORed source follows as the tail
 * (see SealTail). The whole text travels as standard base64 with `+`→`-` and
 * `/`→`_`, padding kept. Every constant arrives through the step's params, so
 * the module holds no bank knowledge. Pure Node crypto.
 */

import type { JsonWebKeyInput, KeyObject } from 'node:crypto';
import { constants, createPublicKey, publicEncrypt, randomInt } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { ISealRsaBlockXorParams } from '../ConfigContracts/index.js';
import { sealTail, SOURCE_INVALID } from './SealTail.js';

/** An RSA public key in JWK form. */
type RsaJwk = JsonWebKeyInput['key'];

/** Draws the seed of one seal. */
type SeedSource = (params: ISealRsaBlockXorParams) => string;

/** What one seal reads: the source text, the hex modulus and the constants. */
interface ISealInput {
  readonly source: string;
  readonly modulusHex: string;
  readonly params: ISealRsaBlockXorParams;
}

const HEX_MODULUS = /^[\da-f]{128,2048}$/i;
const ODD_HEX = /[13579bdf]$/i;
const MIN_MODULUS_BITS = 512;
const MAX_SOURCE_CHARS = 256;
const KEY_INVALID = 'seal key invalid';

/**
 * Draw one character of the alphabet with the CSPRNG.
 * @param alphabet - Seed alphabet.
 * @returns One character of it.
 */
function drawChar(alphabet: string): string {
  const index = randomInt(alphabet.length);
  return alphabet[index];
}

/**
 * The production seed source: `seedLength` characters of `seedAlphabet`.
 * @param params - Seal constants.
 * @returns A fresh seed.
 */
function randomSeed(params: ISealRsaBlockXorParams): string {
  const picks = Array.from({ length: params.seedLength }, (): string => {
    return drawChar(params.seedAlphabet);
  });
  return picks.join('');
}

/**
 * Whether the modulus text is even-length hex of an odd value.
 * @param modulusHex - Candidate modulus.
 * @returns True when the text can be an RSA modulus.
 */
function isModulusText(modulusHex: string): boolean {
  if (!HEX_MODULUS.test(modulusHex) || modulusHex.length % 2 !== 0) return false;
  return ODD_HEX.test(modulusHex);
}

/**
 * Even-length hex of a non-negative integer.
 * @param value - Integer.
 * @returns Its hex, with a leading zero when needed.
 */
function evenHex(value: number): string {
  const hex = value.toString(16);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}

/**
 * The RSA public JWK of a hex modulus and an exponent.
 * @param modulusHex - Modulus as hex.
 * @param exponent - Public exponent.
 * @returns The JWK.
 */
function jwkOf(modulusHex: string, exponent: number): RsaJwk {
  const exponentHex = evenHex(exponent);
  const modulus = Buffer.from(modulusHex, 'hex');
  const publicExponent = Buffer.from(exponentHex, 'hex');
  return { kty: 'RSA', n: modulus.toString('base64url'), e: publicExponent.toString('base64url') };
}

/**
 * Import a public JWK without throwing.
 * @param jwk - RSA public JWK.
 * @returns The key, or false when Node refuses it.
 */
function tryPublicKey(jwk: RsaJwk): KeyObject | false {
  try {
    return createPublicKey({ format: 'jwk', key: jwk });
  } catch {
    return false;
  }
}

/**
 * The bank's public key, when the modulus is sound and at least 512 bits.
 * @param modulusHex - Modulus as hex.
 * @param exponent - Public exponent.
 * @returns The key, or `seal key invalid`.
 */
function publicKeyOf(modulusHex: string, exponent: number): Procedure<KeyObject> {
  if (!isModulusText(modulusHex)) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  const jwk = jwkOf(modulusHex, exponent);
  const key = tryPublicKey(jwk);
  const bits = key === false ? 0 : (key.asymmetricKeyDetails?.modulusLength ?? 0);
  if (key === false || bits < MIN_MODULUS_BITS) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  return succeed(key);
}

/**
 * Split text into chunks of at most `size` characters.
 * @param text - Text to split.
 * @param size - Chunk size.
 * @returns The chunks, in order.
 */
function chunksOf(text: string, size: number): readonly string[] {
  const count = Math.ceil(text.length / size);
  return Array.from({ length: count }, (_, index): string => {
    return text.slice(index * size, (index + 1) * size);
  });
}

/**
 * RSA-PKCS#1 v1.5 encrypt one ASCII chunk.
 * @param key - Bank public key.
 * @param chunk - ASCII chunk.
 * @returns The ciphertext as hex.
 */
function encryptBlock(key: KeyObject, chunk: string): string {
  const plain = Buffer.from(chunk, 'ascii');
  const cipher = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, plain);
  return cipher.toString('hex');
}

/**
 * Build the RSA envelope of the prefixed seed, or report a block the key refuses.
 * @param key - Bank public key.
 * @param seed - The seal's seed.
 * @param params - Seal constants.
 * @returns The envelope text, or false.
 */
function tryEnvelope(key: KeyObject, seed: string, params: ISealRsaBlockXorParams): string | false {
  try {
    const chunks = chunksOf(params.prefix + seed, params.blockChars);
    const blocks = chunks.map((chunk): string => encryptBlock(key, chunk));
    return blocks.join(params.blockSeparator) + params.envelopeTerminator;
  } catch {
    return false;
  }
}

/**
 * Encode text as standard base64 with `+`→`-`, `/`→`_`, padding kept.
 * @param text - Envelope plus tail.
 * @returns The sealed value.
 */
function toBase64Url(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  const standard = bytes.toString('base64');
  return standard.replaceAll('+', '-').replaceAll('/', '_');
}

/**
 * Seal a source under an imported key and a drawn seed.
 * @param key - Bank public key.
 * @param input - Seal input.
 * @param seed - The seal's seed.
 * @returns The sealed value.
 */
function sealWithKey(key: KeyObject, input: ISealInput, seed: string): Procedure<string> {
  const envelope = tryEnvelope(key, seed, input.params);
  if (envelope === false) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  const tail = sealTail(input.source, seed);
  if (!isOk(tail)) return tail;
  const sealed = toBase64Url(envelope + tail.value);
  return succeed(sealed);
}

/**
 * Seal a source of 1–256 characters under the bank's hex modulus. Failures
 * name no value: `seal key invalid` or `seal source invalid`.
 * @param input - Seal input.
 * @param drawSeed - Seed source; the CSPRNG source when absent (tests inject one).
 * @returns The sealed value.
 */
function sealRsaBlockXor(input: ISealInput, drawSeed: SeedSource = randomSeed): Procedure<string> {
  const isSized = input.source.length > 0 && input.source.length <= MAX_SOURCE_CHARS;
  if (!isSized) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  const keyProc = publicKeyOf(input.modulusHex, input.params.exponent);
  if (!isOk(keyProc)) return keyProc;
  const seed = drawSeed(input.params);
  return sealWithKey(keyProc.value, input, seed);
}

export type { ISealInput, SeedSource };
export { sealRsaBlockXor };
