/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message: Error.message for Error instances, the string itself for strings, or `String(error)` for other values.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export default toErrorMessage;
export { toErrorMessage };
