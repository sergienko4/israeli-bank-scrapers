/**
 * Shared constants + helpers for the ApiDirectCallActions cluster:
 * phase label, safeInvoke wrapper, and the IAuthFlowCallback alias.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IAuthFlowInfo } from '../../../Base/Interface.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** Diagnostic label for the phase — appears in error messages. */
const PHASE_LABEL = 'api-direct-call';

/**
 * The one sentence emitted whenever a stored long-term token failed to
 * carry a session and an SMS login was spent instead.
 *
 * <p>Shared so the two places a warm session can silently degrade — the
 * initial prime and a mid-run cold recovery — speak with one voice; a
 * reader grepping the logs for this string finds both.
 */
const COLD_FALLBACK_DETAIL =
  'stored long-term token was not accepted; fell back to the full SMS login';

/** ScraperOptions callback signature — surfaced at the bank surface. */
type IAuthFlowCallback = (info: IAuthFlowInfo) => void | Promise<void>;

/**
 * Build a Procedure failure for an exception thrown by `safeInvoke`.
 * @param label - Short context for the error.
 * @param error - Captured exception.
 * @returns Procedure failure wrapping the thrown error.
 */
function buildThrowFailure<T>(label: string, error: unknown): Procedure<T> {
  const message = toErrorMessage(error as Error);
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ${label} threw: ${message}`);
}

/**
 * Convert thrown errors into Procedure failures — same shape as the
 * plugin-based safeInvoke.
 * @param label - Short context for error diagnostics.
 * @param fn - Async function to invoke.
 * @returns Procedure resolved from the call.
 */
async function safeInvoke<T>(
  label: string,
  fn: () => Promise<Procedure<T>>,
): Promise<Procedure<T>> {
  try {
    return await fn();
  } catch (error) {
    return buildThrowFailure<T>(label, error);
  }
}

export { COLD_FALLBACK_DETAIL, PHASE_LABEL, safeInvoke };
export type { IAuthFlowCallback };
