/**
 * Waiting helpers for tests that read a run's retained `pipeline.log`.
 *
 * <p>A run's file is only complete once its descriptor lease has closed, because
 * retirement flushes the worker before it closes the descriptor.
 */

import type { IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';

const POLL_MS = 20;

/**
 * Wait a few milliseconds.
 * @returns Resolves after the pause.
 */
function pause(): Promise<true> {
  return new Promise<true>(resolve => {
    setTimeout(resolve, POLL_MS, true);
  });
}

/**
 * Poll until a descriptor lease has been closed, or the deadline passes.
 * @param lease - The lease to watch.
 * @param deadlineMs - Epoch-ms deadline.
 * @returns True once the lease is closed.
 */
async function awaitLeaseClosed(lease: IFileLease, deadlineMs: number): Promise<boolean> {
  if (lease.isClosed) return true;
  if (Date.now() >= deadlineMs) return false;
  await pause();
  return awaitLeaseClosed(lease, deadlineMs);
}

export { awaitLeaseClosed, pause };
