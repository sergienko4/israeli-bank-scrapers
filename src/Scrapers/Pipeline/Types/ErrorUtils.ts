/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message: Error.message for Error instances, the string itself for strings, or `String(error)` for other values.
 */
/** Normalized error message string extracted from any thrown value. */
type ErrorMsgStr = string;

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message: Error.message for Error instances, the string itself for strings, or `String(error)` for other values.
 */
function toErrorMessage(error: Error | string): ErrorMsgStr {
  if (error instanceof Error) return error.message;
  return error;
}

export default toErrorMessage;
export { toErrorMessage };
