/**
 * Oracle inputs for the "any caught value" contract. JavaScript lets code
 * throw, or reject with, anything — so a handler that assumes it caught an
 * Error, or a string, throws again inside the very catch meant to contain
 * the failure. Every handler test runs the same rows.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';

/** One value a catch block may receive. */
interface ICaughtValue {
  readonly label: string;
  readonly reason: unknown;
}

/**
 * A `toString` that throws, as a hostile thrown object may carry.
 * @returns Never; always throws.
 */
function throwingToString(): string {
  throw new ScraperError('toString threw');
}

/** An Error whose `message` is not a string. */
const NUMBER_MESSAGE_ERROR = Object.assign(new Error('x'), { message: 42 });

/** Every caught value that is not an Error with a string message. */
const ODD_CAUGHT_VALUES: readonly ICaughtValue[] = [
  { label: 'null', reason: null },
  { label: 'undefined', reason: undefined },
  { label: 'a number', reason: 42 },
  { label: 'a symbol', reason: Symbol('odd') },
  { label: 'an object whose toString throws', reason: { toString: throwingToString } },
  { label: 'an error whose message is not a string', reason: NUMBER_MESSAGE_ERROR },
];

export type { ICaughtValue };
export { ODD_CAUGHT_VALUES };
