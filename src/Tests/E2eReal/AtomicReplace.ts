/**
 * AtomicReplace — move a freshly written file over a destination that another
 * process may be holding open.
 *
 * <p>`fs.rename` *is* an overwrite on every platform we support: libuv calls
 * `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` on Windows (`src/win/fs.c`),
 * so a claim that the destination must be unlinked first is wrong. What is
 * true is that Windows, unlike POSIX, refuses the move while someone else has
 * the destination open — an antivirus scanner, the search indexer, or a
 * concurrent reader is enough. libuv maps that to `EBUSY`
 * (`ERROR_SHARING_VIOLATION`, `ERROR_LOCK_VIOLATION`) or `EPERM`
 * (`ERROR_ACCESS_DENIED`) in `src/win/error.c`.
 *
 * <p>Those holds are momentary, so a bounded retry clears them. Without one,
 * the caller drops the payload it just wrote — for the token cache that costs
 * the user the SMS the cache exists to avoid, which is issue #576 again by
 * another route.
 */

import * as fs from 'node:fs/promises';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

/**
 * Errno codes meaning "someone else is holding the destination", as opposed
 * to a fault that retrying cannot fix.
 */
const CONTENTION_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM']);

/** How many times to try the move before giving up. */
const REPLACE_ATTEMPTS = 5;

/** Base backoff; multiplied by the attempt number for a linear ramp. */
const REPLACE_BACKOFF_MS = 20;

/** The rename primitive, injectable so contention can be tested off Windows. */
export type RenameFn = (from: string, to: string) => Promise<void>;

/** Inputs for {@link replaceAtomically}. */
export interface IReplaceArgs {
  /** Absolute path of the already-written source file. */
  readonly from: string;
  /** Absolute path to replace. */
  readonly to: string;
  /** Rename primitive; defaults to `fs.rename`. */
  readonly rename?: RenameFn;
}

/**
 * Classify a failure as transient destination contention.
 * @param error - Failure raised by the rename primitive.
 * @returns True when another process merely holds the destination.
 */
function isContended(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  return CONTENTION_CODES.has(code);
}

/**
 * Wait out a contended replace, or rethrow when retrying cannot help.
 * @param attempt - Attempt that just failed (1-based).
 * @param error - Failure raised by the rename primitive.
 * @returns True once the caller may try again.
 */
async function awaitRetry(attempt: number, error: unknown): Promise<boolean> {
  if (attempt >= REPLACE_ATTEMPTS || !isContended(error)) throw error;
  await setTimeoutPromise(REPLACE_BACKOFF_MS * attempt);
  return true;
}

/**
 * Attempt the move, recursing while the destination is merely contended.
 * @param args - Source, destination, and the rename primitive.
 * @param attempt - 1-based attempt counter.
 * @returns True once the destination holds the source's bytes.
 */
async function attemptReplace(args: IReplaceArgs, attempt: number): Promise<boolean> {
  const rename = args.rename ?? fs.rename;
  try {
    await rename(args.from, args.to);
    return true;
  } catch (error) {
    await awaitRetry(attempt, error);
    return attemptReplace(args, attempt + 1);
  }
}

/**
 * Replace `to` with `from` atomically, riding out transient Windows holds.
 * @param args - Source, destination, and an optional rename primitive.
 * @returns True once the replacement is in place.
 */
export async function replaceAtomically(args: IReplaceArgs): Promise<boolean> {
  return attemptReplace(args, 1);
}
