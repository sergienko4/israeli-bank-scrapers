/**
 * Owned file-lease lifecycle: flush polling and the single-close contract.
 *
 * <p>The descriptor is shared with the Pino transport worker, so these specs
 * pin both halves of the handshake: `awaitLeaseFlush` only settles once the
 * bytes it counted reached disk, and `closeFileLeaseAsync` closes at most once
 * while tolerating a descriptor the worker already closed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import {
  awaitLeaseFlush,
  type IFileLease,
} from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import { makeLeaseCloseCallback } from '../../../../Scrapers/Pipeline/Logging/FileLeaseClose.js';

/** Poll interval used by the flush specs. */
const POLL_MS = 1;

/** Bounded wait for an asynchronous lease callback. */
const SETTLE_WAIT_MS = 2_000;

/** Event-loop poll interval while waiting for a condition. */
const WAIT_STEP_MS = 5;

/** Temporary directory plus the lease on its `pipeline.log`. */
interface ITempLease {
  readonly dir: string;
  readonly lease: IFileLease;
}

/**
 * Create a temporary directory and open a lease on its `pipeline.log`.
 * @returns Temporary directory and the lease on its log file.
 */
function makeTempLease(): ITempLease {
  const tmpRoot = os.tmpdir();
  const prefixPath = path.join(tmpRoot, 'lease-flush-');
  const dir = fs.mkdtempSync(prefixPath);
  const logFile = path.join(dir, 'pipeline.log');
  return { dir, lease: openLease(logFile) };
}

/**
 * Open `file` in append mode and build the lease retirement receives.
 * @param file - Destination log file.
 * @returns Lease carrying the descriptor identity captured at open time.
 */
function openLease(file: string): IFileLease {
  const fd = fs.openSync(file, 'a');
  const stats = fs.fstatSync(fd);
  return {
    fd,
    dev: stats.dev,
    ino: stats.ino,
    targetBytes: stats.size,
    isFrozen: false,
    isClosing: false,
    isClosed: false,
  };
}

/**
 * Yield event-loop turns until `predicate()` holds or the deadline expires.
 * @param predicate - Condition being awaited.
 * @returns True when the predicate held before the deadline.
 */
function waitUntil(predicate: () => boolean): Promise<boolean> {
  const deadline = Date.now() + SETTLE_WAIT_MS;
  /**
   * Poll once and reschedule until the predicate holds or the deadline expires.
   * @returns True once the predicate holds; false at the deadline.
   */
  const poll = (): Promise<boolean> => {
    if (predicate()) return Promise.resolve(true);
    if (Date.now() >= deadline) return Promise.resolve(false);
    const delay = new Promise<true>(resolve => {
      setTimeout(resolve, WAIT_STEP_MS, true);
    });
    return delay.then(poll);
  };
  return poll();
}

describe('awaitLeaseFlush — waits for counted bytes to reach disk', () => {
  it('settles immediately when the logger is terminal-only', () => {
    const onSettled = jest.fn<boolean, [string?]>((): boolean => true);
    const didSettle = awaitLeaseFlush({ lease: false, pollMs: POLL_MS, onSettled });
    expect(didSettle).toBe(true);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]).toEqual([]);
  });

  it('settles immediately when the lease is already closed', () => {
    const { dir, lease } = makeTempLease();
    lease.isClosed = true;
    const onSettled = jest.fn<boolean, [string?]>((): boolean => true);
    try {
      awaitLeaseFlush({ lease, pollMs: POLL_MS, onSettled });
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      fs.closeSync(lease.fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the fstat failure when the descriptor is gone', async () => {
    const { dir, lease } = makeTempLease();
    fs.closeSync(lease.fd);
    const onSettled = jest.fn<boolean, [string?]>((): boolean => true);
    try {
      awaitLeaseFlush({ lease, pollMs: POLL_MS, onSettled });
      const didSettle = await waitUntil((): boolean => onSettled.mock.calls.length > 0);
      expect(didSettle).toBe(true);
      expect(onSettled.mock.calls[0]?.[0]).toMatch(/EBADF/u);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('polls until the file grows to the counted byte target', async () => {
    const { dir, lease } = makeTempLease();
    const target = Buffer.from('ten-bytes!');
    lease.targetBytes = fs.fstatSync(lease.fd).size + target.length;
    const onSettled = jest.fn<boolean, [string?]>((): boolean => true);
    try {
      awaitLeaseFlush({ lease, pollMs: POLL_MS, onSettled });
      expect(onSettled).not.toHaveBeenCalled();
      // Let at least one poll observe the short file and schedule a retry.
      await new Promise<true>(resolve => {
        setTimeout(resolve, POLL_MS * 5, true);
      });
      expect(onSettled).not.toHaveBeenCalled();
      fs.writeSync(lease.fd, target);
      const didSettle = await waitUntil((): boolean => onSettled.mock.calls.length > 0);
      expect(didSettle).toBe(true);
      expect(onSettled.mock.calls[0]).toEqual([]);
    } finally {
      fs.closeSync(lease.fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('closeFileLeaseAsync — unexpected close failures stay visible', () => {
  it('reports an fs.close error instead of swallowing it', () => {
    const { dir, lease } = makeTempLease();
    const onCloseError = jest.fn<boolean, [string]>((): boolean => true);
    const onClosed = makeLeaseCloseCallback(lease, onCloseError);
    const closeError = new Error('EBADF: bad file descriptor, close');
    try {
      onClosed(closeError);
      expect(onCloseError).toHaveBeenCalledTimes(1);
      expect(onCloseError.mock.calls[0]?.[0]).toBe(closeError.message);
      expect(lease.isClosed).toBe(true);
    } finally {
      fs.closeSync(lease.fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
