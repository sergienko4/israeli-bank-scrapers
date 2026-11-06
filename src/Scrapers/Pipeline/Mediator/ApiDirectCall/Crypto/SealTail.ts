/**
 * SealTail — the XOR tail of the `rsa-pkcs1-block-xor` seal. Each
 * UTF-16 unit of the source is XORed with the seed (cycled), percent-encoded
 * with `encodeURIComponent`, and `!'()*~` are escaped as `%` + lower-case hex.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

/** Characters `encodeURIComponent` leaves bare that the seal still escapes. */
const BARE_RESERVED = /[!'()*~]/g;

/** Message of every tail failure; it names no value. */
const SOURCE_INVALID = 'seal source invalid';

/**
 * Read one UTF-16 unit without combining a surrogate pair.
 * @param text - Text containing the unit.
 * @param index - Non-negative, zero-based unit index.
 * @returns The unit's code, or NaN outside the string.
 */
function codeUnitAt(text: string, index: number): number {
  const point = text.at(index)?.codePointAt(0);
  return Number(point);
}

/**
 * Escape one bare reserved character as `%` + lower-case hex.
 * @param char - One of `!'()*~`.
 * @returns Its percent escape.
 */
function escapeReserved(char: string): string {
  const code = codeUnitAt(char, 0);
  return `%${code.toString(16)}`;
}

/**
 * XOR each UTF-16 unit of the source with the cycled seed.
 * @param source - Text to mask.
 * @param seed - The seal's seed.
 * @returns The masked text.
 */
function xorWithSeed(source: string, seed: string): string {
  const codes = Array.from(
    { length: source.length },
    (_, index): number => codeUnitAt(source, index) ^ codeUnitAt(seed, index % seed.length),
  );
  return String.fromCodePoint(...codes);
}

/**
 * Percent-encode masked text, or report a lone surrogate.
 * @param masked - XOR-masked text.
 * @returns The encoded text, or false when it holds a lone surrogate.
 */
function tryEncode(masked: string): string | false {
  try {
    return encodeURIComponent(masked);
  } catch {
    return false;
  }
}

/**
 * Build the seal tail of a source under a seed.
 * @param source - Text to seal.
 * @param seed - The seal's seed.
 * @returns The percent-encoded tail, or `seal source invalid`.
 */
function sealTail(source: string, seed: string): Procedure<string> {
  const masked = xorWithSeed(source, seed);
  const encoded = tryEncode(masked);
  if (encoded === false) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  const tail = encoded.replaceAll(BARE_RESERVED, escapeReserved);
  return succeed(tail);
}

export { sealTail, SOURCE_INVALID };
