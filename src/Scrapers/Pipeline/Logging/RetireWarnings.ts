/**
 * Out-of-band warnings and error routing for a retired log transport.
 *
 * A superseded `ThreadStream` outlives its logger by one drain window, so its
 * failures cannot be logged: the logger that would report them is the one being
 * retired. Retirement therefore reports through `process.emitWarning`, while
 * expected teardown noise (stale post-close writes and the terminating worker's
 * exit) stays silent so a genuine disk or drain failure remains visible.
 */

import { toError } from '../Types/ErrorUtils.js';

/** Prefix emitted out-of-band when draining a retired worker transport fails. */
const RETIRED_DRAIN_FAILED = 'superseded log transport failed while draining:';

/** Expected `ThreadStream` errors emitted only when a stale unproxied caller writes post-close. */
const STALE_WORKER_MESSAGES = new Set(['the worker is ending', 'the worker has exited']);

/** Error message emitted by `ThreadStream` when `worker.terminate()` stops the worker. */
const WORKER_TERMINATED_MESSAGE = 'the worker thread exited';

/** Mutable lifecycle flags shared by the retirement steps. */
export interface IRetirementState {
  isSettled: boolean;
  isTerminating: boolean;
  timer?: ReturnType<typeof globalThis.setTimeout>;
}

/**
 * Emit an out-of-band warning when retiring a superseded transport fails.
 * @param reason - Failure description surfaced via `process.emitWarning`.
 * @returns Always true.
 */
export function emitRetiredDrainWarning(reason: string): true {
  process.emitWarning(`${RETIRED_DRAIN_FAILED} ${reason}`);
  return true;
}

/**
 * Report an asynchronous `worker.terminate()` rejection out-of-band.
 * @param rawError - Rejection value from `worker.terminate()`.
 * @returns Always true.
 */
export function handleTerminateRejection(rawError: Error): true {
  return emitRetiredDrainWarning(toError(rawError).message);
}

/**
 * Build the `'error'` listener guarding a retiring `ThreadStream`.
 * @param state - Mutable per-retirement lifecycle state.
 * @returns Listener suppressing stale-write/expected-exit noise while warning on real errors.
 */
export function makeRetiredErrorListener(state: IRetirementState): (rawError: Error) => boolean {
  return (rawError: Error): boolean => {
    const error = toError(rawError);
    if (STALE_WORKER_MESSAGES.has(error.message)) return false;
    if (state.isTerminating && error.message === WORKER_TERMINATED_MESSAGE) return false;
    return emitRetiredDrainWarning(error.message);
  };
}
