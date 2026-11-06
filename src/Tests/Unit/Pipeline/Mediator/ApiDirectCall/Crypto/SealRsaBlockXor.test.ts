/**
 * The `rsa-pkcs1-block-xor` seal: a random seed RSA-PKCS#1 v1.5
 * sealed in short ASCII blocks under the bank's modulus, the source XORed
 * with that seed and percent-encoded, both sent as padded base64url.
 */

import type { ISealRsaBlockXorParams } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { sealRsaBlockXor } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/SealRsaBlockXor.js';
import { makeSealKey, openSeal, SEAL_PARAMS } from '../../../../../Helpers/SealOpener.js';

const KEY = makeSealKey();
const FIXED_SEED = 'Ab3Zx9Qk0mTz';

/**
 * Seed source that always draws the fixed seed.
 * @returns The fixed seed.
 */
function fixedSeed(): string {
  return FIXED_SEED;
}

/**
 * Seal a source under the shared key, optionally with the fixed seed.
 * @param source - Text to seal.
 * @param drawSeed - Seed source; the production source when absent.
 * @returns The seal procedure.
 */
function sealOf(
  source: string,
  drawSeed?: (params: ISealRsaBlockXorParams) => string,
): ReturnType<typeof sealRsaBlockXor> {
  const input = { source, modulusHex: KEY.modulusHex, params: SEAL_PARAMS };
  return sealRsaBlockXor(input, drawSeed);
}

/**
 * Seal a source that must succeed and return the sealed text.
 * @param source - Text to seal.
 * @returns The sealed text.
 */
function sealedText(source: string): string {
  const result = sealOf(source, fixedSeed);
  if (!result.success) throw new TypeError(result.errorMessage);
  return result.value;
}

/**
 * Text whose every UTF-16 unit is the given code.
 * @param codes - UTF-16 code units.
 * @returns The text.
 */
function fromCodes(codes: readonly number[]): string {
  return String.fromCharCode(...codes);
}

/** Source whose XOR with FIXED_SEED is `!'()*~`, space, é, aZ, א, `-.` (13 units, seed wraps). */
const GOLDEN_SOURCE = fromCodes([
  0x60, 0x45, 0x1b, 0x73, 0x52, 0x47, 0x71, 0x82, 0x51, 0x37, 0x584, 0x57, 0x6f,
]);
const GOLDEN_TAIL = '%21%27%28%29%2a%7e%20%C3%A9aZ%D7%90-.';

describe('sealRsaBlockXor', () => {
  it('writes the tail of the live-verified client for a fixed seed', () => {
    const sealed = sealedText(GOLDEN_SOURCE);
    const opened = openSeal(sealed, KEY);
    expect(opened.tail).toBe(GOLDEN_TAIL);
    expect(opened.source).toBe(GOLDEN_SOURCE);
  });

  it('keeps UTF-16 unit masking for a surrogate pair', () => {
    const source = '\uD83D\uDE00';
    const sealed = sealedText(source);
    const opened = openSeal(sealed, KEY);
    expect(opened.tail).toBe('%F0%AF%89%A2');
    expect(opened.source).toBe(source);
  });

  it('seals the prefix and seed in RSA blocks of seven ASCII characters', () => {
    const sealed = sealedText('syn-pass');
    const opened = openSeal(sealed, KEY);
    expect(opened.blocks).toEqual(['[ENC]Ab', '3Zx9Qk0', 'mTz']);
    expect(opened.seed).toBe(FIXED_SEED);
  });

  it('sends base64url text with its padding kept', () => {
    const sealed = ['a', 'ab', 'abc'].map(sealedText);
    for (const text of sealed) {
      expect(text).toMatch(/^[\w-]+={0,2}$/);
      const standard = text.replaceAll('-', '+').replaceAll('_', '/');
      const reencoded = Buffer.from(standard, 'base64').toString('base64');
      expect(reencoded).toBe(standard);
    }
    const padded = sealed.filter((text): boolean => text.endsWith('='));
    expect(padded.length).toBeGreaterThan(0);
  });

  it('draws a fresh seed from the alphabet when no seed source is given', () => {
    const seeds = ['p', 'p', 'p'].map((source): string => {
      const result = sealOf(source);
      if (!result.success) throw new TypeError(result.errorMessage);
      return openSeal(result.value, KEY).seed;
    });
    for (const seed of seeds) {
      expect(seed).toHaveLength(SEAL_PARAMS.seedLength);
      const chars = Array.from({ length: seed.length }, (_, index): string => seed.charAt(index));
      const outside = chars.filter((char): boolean => !SEAL_PARAMS.seedAlphabet.includes(char));
      expect(outside).toEqual([]);
    }
    const distinct = new Set(seeds);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it.each([
    ['non-hex', `${KEY.modulusHex.slice(0, -2)}zz`],
    ['odd length', KEY.modulusHex.slice(0, -1)],
    ['an even value', `${KEY.modulusHex.slice(0, -1)}0`],
    ['under 128 hex characters', 'f'.repeat(126)],
    ['over 2048 hex characters', `${'f'.repeat(2049)}1`],
    ['under 512 bits', `00${'f'.repeat(125)}1`],
  ])('fails "seal key invalid" for a modulus that is %s', (_label, modulusHex) => {
    const result = sealRsaBlockXor({ source: 'p', modulusHex, params: SEAL_PARAMS }, fixedSeed);
    expect(result).toMatchObject({ success: false, errorMessage: 'seal key invalid' });
  });

  it.each([
    ['empty', ''],
    ['257 characters', 'p'.repeat(257)],
    ['a lone surrogate', fromCodes([0xd800])],
  ])('fails "seal source invalid" for a source that is %s', (_label, source) => {
    const result = sealOf(source, fixedSeed);
    expect(result).toMatchObject({ success: false, errorMessage: 'seal source invalid' });
  });

  it('seals a 256-character source', () => {
    const source = 'p'.repeat(256);
    const sealed = sealedText(source);
    const opened = openSeal(sealed, KEY);
    expect(opened.source).toBe(source);
  });
});
