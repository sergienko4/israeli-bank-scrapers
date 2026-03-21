/**
 * Safe error message extraction for catch blocks.
 * JavaScript allows throwing any value — this normalizes to string.
 */

/**
 * Safely extract a message string from an unknown thrown value.
 * @param error - The unknown caught value.
 * @returns A string message, or 'Unknown error' for non-string non-Error values.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export default toErrorMessage;
export { toErrorMessage };
