/**
 * Unit tests for the shared transport-failure classifier: aborts map to
 * TIMEOUT, socket codes (own or in a fetch cause) map to NETWORK_ERROR, and
 * everything else stays GENERIC.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import transportErrorType from '../../../../../Scrapers/Pipeline/Strategy/Fetch/TransportFailure.js';

/**
 * Build an object whose named field getter throws.
 * @param field - Field to install.
 * @returns The hostile error-like value.
 */
function throwingField(field: 'name' | 'code' | 'cause'): object {
  const value = {};
  Object.defineProperty(value, field, {
    /**
     * Fail on every read.
     * @returns Never.
     */
    get: (): never => {
      throw new TypeError(`cannot read ${field}`);
    },
  });
  return value;
}

/** Labeled error shape and its expected public type. */
const CASES: readonly [string, unknown, ScraperErrorTypes][] = [
  ['a TimeoutError', new DOMException('aborted', 'TimeoutError'), ScraperErrorTypes.Timeout],
  ['an AbortError', new DOMException('aborted', 'AbortError'), ScraperErrorTypes.Timeout],
  [
    'an own ECONNRESET code',
    Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    ScraperErrorTypes.NetworkError,
  ],
  [
    'a cause ECONNREFUSED code',
    Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    }),
    ScraperErrorTypes.NetworkError,
  ],
  [
    'an undici socket code',
    Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }),
    }),
    ScraperErrorTypes.NetworkError,
  ],
  [
    'an unknown system code',
    Object.assign(new Error('protocol'), { code: 'EPROTO' }),
    ScraperErrorTypes.Generic,
  ],
  ['a plain error', new Error('boom'), ScraperErrorTypes.Generic],
  ['a thrown string', 'ECONNRESET', ScraperErrorTypes.Generic],
  ['null', null, ScraperErrorTypes.Generic],
  ['a throwing name getter', throwingField('name'), ScraperErrorTypes.Generic],
  ['a throwing code getter', throwingField('code'), ScraperErrorTypes.Generic],
  ['a throwing cause getter', throwingField('cause'), ScraperErrorTypes.Generic],
];

describe('transportErrorType', () => {
  it.each(CASES)('classifies %s', (_label, error, expected): void => {
    const actual = transportErrorType(error);
    expect(actual).toBe(expected);
  });
});
