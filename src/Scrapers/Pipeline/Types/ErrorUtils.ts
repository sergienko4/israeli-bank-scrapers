/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

import type { Brand } from './Brand.js';

/** Normalised error message — branded for Rule #15. */
type ErrorMessageString = Brand<string, 'ErrorMessageString'>;

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message: Error.message for Error instances, the string itself for strings, or `String(error)` for other values.
 */
function toErrorMessage(error: Error | string): ErrorMessageString {
  if (error instanceof Error) return error.message as ErrorMessageString;
  return error as ErrorMessageString;
}

export default toErrorMessage;
export { toErrorMessage };
