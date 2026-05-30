/**
 * AuthFailureWatcher State — captured-failure recording + read helpers.
 */

import type { Brand } from '../../../Types/Brand.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { IAuthFailure, IWatcherState } from './Types.js';

const LOG = getDebug(import.meta.url);

/** Nominal type for the "did we record" outcome of recordFailure. */
export type RecordOutcome = Brand<boolean, 'RecordOutcome'>;

/**
 * Record a captured failure on state. Logs first capture only.
 * Idempotent — re-recording on the same state is a no-op.
 * @param state - Watcher state.
 * @param failure - Captured failure record.
 * @returns True when this call recorded a new failure, false when a
 *   prior call had already captured one (idempotent skip).
 */
export function recordFailure(state: IWatcherState, failure: IAuthFailure): RecordOutcome {
  if (state.detected) return false as RecordOutcome;
  state.detected = failure;
  LOG.debug({
    classifier: failure.classifier,
    status: failure.status,
    url: maskVisibleText(failure.url),
  });
  return true as RecordOutcome;
}

/**
 * Read state.detected through a function call so TS flow analysis cannot
 * narrow the value back to the literal `false` after an earlier early-
 * return check. Used to re-poll state across an `await` boundary.
 * @param state - Watcher state.
 * @returns Current detected value.
 */
export function readDetected(state: IWatcherState): false | IAuthFailure {
  return state.detected;
}
