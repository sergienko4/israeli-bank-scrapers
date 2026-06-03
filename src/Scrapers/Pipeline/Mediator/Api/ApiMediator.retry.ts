/**
 * Retry-on-401 orchestration for ApiMediator operations.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import { setRawAuthOp } from './ApiMediator.state.js';
import type { IMediatorState } from './ApiMediator.types.js';

/** Cached regex matching the embedded HTTP status prefix `<sp>401:<sp>`. */
const STATUS_401_REGEX = /\s401:\s/;

/**
 * Bundled args for `retryOn401Op` (keeps the signature single-line).
 */
interface IRetryOn401Args<T> {
  readonly state: IMediatorState;
  readonly fire: () => Promise<Procedure<T>>;
}

/**
 * Invoke the resolver's `refresh()` with an exception safety net.
 * @param state - Mediator state.
 * @returns Refresh procedure (or a Generic failure when the resolver threw).
 */
async function safeRefreshOp(state: IMediatorState): Promise<Procedure<string>> {
  try {
    return await state.resolver.refresh();
  } catch (error) {
    const message = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `token resolver threw: ${message}`);
  }
}

/**
 * Apply a refreshed Authorization header when present and non-empty.
 * @param state - Mediator state.
 * @param refreshed - Refresh procedure result.
 * @returns True iff the new header was installed and a retry should proceed.
 */
function applyRefreshedAuth(state: IMediatorState, refreshed: Procedure<string>): boolean {
  if (!isOk(refreshed)) return false;
  if (refreshed.value.length === 0) return false;
  setRawAuthOp(state, refreshed.value);
  return true;
}

/**
 * Decide whether the first attempt's failure is a 401 worth retrying.
 * @param first - First-attempt procedure.
 * @returns True iff the failure carries a `401:` status marker.
 */
function isUnauthorizedFailure<T>(first: Procedure<T>): boolean {
  if (first.success) return false;
  return STATUS_401_REGEX.test(first.errorMessage);
}

/**
 * Run a request once, and on a 401 response refresh and retry once.
 * @param args - Bundled mediator-state + fire-callable.
 * @returns Procedure from the first or second attempt.
 */
async function retryOn401Op<T>(args: IRetryOn401Args<T>): Promise<Procedure<T>> {
  const first = await args.fire();
  if (!isUnauthorizedFailure(first)) return first;
  const refreshed = await safeRefreshOp(args.state);
  const isReady = applyRefreshedAuth(args.state, refreshed);
  if (!isReady) return first;
  return args.fire();
}

export { retryOn401Op, safeRefreshOp };
export type { IRetryOn401Args };
