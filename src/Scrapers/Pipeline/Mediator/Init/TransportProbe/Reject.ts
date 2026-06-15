/**
 * Forward a caught error (typed as `unknown`) to a Promise reject hook
 * and acknowledge the listener. Shared by the DNS, TCP, and TLS phase
 * handlers so each stays within the 10-LoC cap.
 */

import { toError } from '../../../Types/ErrorUtils.js';

/**
 * Forward a caught error (typed as `unknown`) to a Promise reject hook
 * and acknowledge the listener. Normalizes `err` into a real `Error`
 * via {@link toError} so the always-resolves; never-throws contract
 * holds even when a dep rejects with a non-Error value (string, plain
 * object, etc.). Saves a 2-line `if`/`return` block in callbacks
 * bumping against the 10-LoC cap.
 *
 * @param reject - Promise reject hook.
 * @param err - Caught value to normalize and propagate.
 * @returns `true` (no-void rule).
 */
function rejectAndAck(reject: (e: Error) => unknown, err: unknown): boolean {
  const normalized = toError(err);
  reject(normalized);
  return true;
}

export default rejectAndAck;
