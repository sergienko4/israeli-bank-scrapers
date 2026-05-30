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

/** Nominal type for the disposed-flag readout — defeats TS narrowing. */
export type DisposedFlag = Brand<boolean, 'DisposedFlag'>;

/**
 * Emit the first-capture log event for {@link recordFailure}. Pulled
 * out so the parent function fits within the 10-LoC cap.
 * @param failure - Captured failure record.
 * @returns Always true (status sentinel — void returns are forbidden).
 */
function logFirstCapture(failure: IAuthFailure): true {
  const { classifier, status, url } = failure;
  LOG.debug({ classifier, status, url: maskVisibleText(url) });
  return true;
}

/**
 * Record a captured failure on state. Logs first capture only.
 * Idempotent — re-recording on the same state is a no-op.
 * @param state - Watcher state.
 * @param failure - Captured failure record.
 * @returns True when this call recorded a new failure, false when a
 *   prior call had already captured one (idempotent skip).
 */
export function recordFailure(state: IWatcherState, failure: IAuthFailure): RecordOutcome {
  if (state.isDisposed) return false as RecordOutcome;
  if (state.detected) return false as RecordOutcome;
  state.detected = failure;
  logFirstCapture(failure);
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

/**
 * Mirror of {@link readDetected} for the `isDisposed` flag — defeats TS
 * flow narrowing so a post-`await` re-check is not flagged as dead code.
 * Returns a branded {@link DisposedFlag} so Rule #15 (no primitive
 * returns) stays satisfied while remaining truthy/falsy at call sites.
 * @param state - Watcher state.
 * @returns Current isDisposed value, branded.
 */
export function readDisposed(state: IWatcherState): DisposedFlag {
  return state.isDisposed as DisposedFlag;
}
