/**
 * Asynchronous close of an owned `pipeline.log` descriptor shared with the
 * Pino transport worker.
 *
 * <p>A graceful end runs `SonicBoom.end()` inside the worker, which closes the
 * descriptor from the same process descriptor table. Re-closing it here would
 * raise `EBADF` — or close an unrelated file if the number was reused — so the
 * close path first checks that `lease.fd` still names the leased file and
 * treats an already-closed or reused number as settled.
 */

import * as fs from 'node:fs';

import type { Brand } from '../Types/Brand.js';
import type { IFileLease } from './FileLease.js';

/** Branded boolean returned when `closeFileLeaseAsync` schedules `fs.close`. */
export type DidCloseLease = Brand<boolean, 'DidCloseLease'>;

/**
 * Check whether `lease.fd` still names the file this lease opened.
 * @param lease - Owned file lease.
 * @returns True when `lease.fd` still refers to the leased log file.
 */
function leaseFdStillRefersToLog(lease: IFileLease): boolean {
  try {
    const stats = fs.fstatSync(lease.fd);
    return stats.dev === lease.dev && stats.ino === lease.ino;
  } catch {
    return false;
  }
}

/**
 * Mark a lease whose descriptor the worker already closed as settled.
 * @param lease - Owned file lease.
 * @returns Branded false: no second `fs.close` was scheduled.
 */
function settleClosedLease(lease: IFileLease): DidCloseLease {
  lease.isClosed = true;
  return false as DidCloseLease;
}

/**
 * Record a lease closed after the worker's graceful end already closed its
 * descriptor. The number is not touched: once the worker closed it, the kernel is
 * free to hand it to another file, and no `fstat` attribute can tell the two apart.
 * @param lease - Owned file lease (or `false` when terminal-only).
 * @returns Branded false: no `fs.close` was scheduled.
 */
export function markLeaseClosedByWorker(lease: IFileLease | false): DidCloseLease {
  if (lease) lease.isClosed = true;
  return false as DidCloseLease;
}

/**
 * Build the `fs.close` completion callback marking `lease.isClosed`.
 * @param lease - Owned file lease being closed.
 * @param onCloseError - Error reporter for unexpected `fs.close` errors.
 * @returns `fs.NoParamCallback`-compatible handler.
 */
export function makeLeaseCloseCallback(
  lease: IFileLease,
  onCloseError: (reason: string) => boolean,
): fs.NoParamCallback {
  return (err): boolean => {
    lease.isClosed = true;
    return err ? onCloseError(err.message) : true;
  };
}

/**
 * Schedule `fs.close` for a descriptor this lease still owns.
 * @param lease - Owned file lease.
 * @param onCloseError - Error reporter for unexpected `fs.close` errors.
 * @returns Branded true: the close was scheduled.
 */
function scheduleLeaseClose(
  lease: IFileLease,
  onCloseError: (reason: string) => boolean,
): DidCloseLease {
  lease.isClosing = true;
  const onClosed = makeLeaseCloseCallback(lease, onCloseError);
  fs.close(lease.fd, onClosed);
  return true as DidCloseLease;
}

/**
 * Asynchronously close an owned `pipeline.log` file descriptor at most once.
 * @param lease - Owned file lease (or `false` when terminal-only).
 * @param onCloseError - Callback reporting unexpected `fs.close` errors.
 * @returns Branded boolean true when `fs.close` was scheduled, else false.
 */
export function closeFileLeaseAsync(
  lease: IFileLease | false,
  onCloseError: (reason: string) => boolean,
): DidCloseLease {
  if (!lease || lease.isClosing || lease.isClosed) return false as DidCloseLease;
  if (!leaseFdStillRefersToLog(lease)) return settleClosedLease(lease);
  return scheduleLeaseClose(lease, onCloseError);
}
