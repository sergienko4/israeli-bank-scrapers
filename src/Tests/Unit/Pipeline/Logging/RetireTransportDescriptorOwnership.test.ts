/**
 * Who closes the shared log descriptor when a retired worker transport is released.
 *
 * <p>After a graceful end the worker has already closed the descriptor, so the main
 * thread must only record the lease as closed. Closing the number again is unsafe:
 * the kernel may have handed it to another file, and no `fstat` attribute
 * (device, inode, size, link count, birth time) reliably tells the two apart. When
 * the worker is instead terminated, nobody knows whether it closed the descriptor,
 * so the best-effort close with its `fstat` check stays.
 *
 * <p>The worker is a fake whose ring buffer is idle, so the graceful handshake is
 * accepted at once and the test decides when the worker "closes". The log file
 * stays open on its own inode throughout, which is exactly what a reused
 * descriptor looks like to an identity check.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import type { IPinoStreamCandidate } from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import { scheduleStreamClose } from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import { awaitCondition } from '../Infrastructure/LogDrain.js';

const STATE_WORDS = 32;
const WAIT_MS = 5_000;
const SHORT_WATCHDOG_MS = 50;
const TMP_BASE = os.tmpdir();
const DIR_PREFIX = path.join(TMP_BASE, 'lease-owner-');

/**
 * Simulate `ThreadStream.unref()`.
 * @returns Always true.
 */
function unrefStub(): boolean {
  return true;
}

const INERT = { unref: unrefStub } as const;

/** A fake worker stream plus the hooks a test drives it with. */
interface IFakeWorker {
  readonly stream: IPinoStreamCandidate;
  readonly hasListener: () => boolean;
  readonly close: () => boolean;
  readonly emitError: (message: string) => boolean;
}

/** A log file in a private directory and the lease retirement receives for it. */
interface IOwnedLease {
  readonly dir: string;
  readonly lease: IFileLease;
}

/**
 * Whether a descriptor number is still open in this process.
 * @param fd - Descriptor number.
 * @returns True while `fstat` succeeds.
 */
function isFdOpen(fd: number): boolean {
  try {
    fs.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
}

/** The listeners a retirement registered on a fake worker. */
interface IListenerLog {
  readonly closers: (() => boolean)[];
  readonly failers: ((error: Error) => boolean)[];
}

/**
 * Build the stream half of a fake worker: it records close and error listeners and
 * accepts the graceful end handshake straight away.
 * @param log - Where registered listeners are kept.
 * @returns A `ThreadStream`-shaped candidate.
 */
function makeIdleStream(log: IListenerLog): IPinoStreamCandidate {
  const state = new Int32Array(STATE_WORDS);
  const idle = { state, ending: false, flushing: false, buf: '' };
  /**
   * Remember the retirement's close listener.
   * @param _event - Event name.
   * @param listener - The listener to fire on close.
   * @returns A dummy emitter.
   */
  const once = (_event: 'close', listener: () => boolean): object => {
    log.closers.push(listener);
    return {};
  };
  /**
   * Remember the retirement's error listener.
   * @param _event - Event name.
   * @param listener - The listener to fire on a worker error.
   * @returns A dummy emitter.
   */
  const on = (_event: 'error', listener: (error: Error) => boolean): object => {
    log.failers.push(listener);
    return {};
  };
  /**
   * Resolve like a worker that exits at once.
   * @returns Exit code 0.
   */
  const terminate = (): Promise<number> => Promise.resolve(0);
  const stream: IPinoStreamCandidate = { closed: false, destroyed: false, once, on, ...INERT };
  const withWorker = { ...stream, worker: { terminate } };
  const implSymbol = Symbol('kImpl');
  Object.defineProperty(withWorker, implSymbol, { value: idle });
  return withWorker;
}

/**
 * A fake worker whose end handshake is accepted immediately.
 * @returns The stream and the hooks that observe and fire its `close` event.
 */
function makeFakeWorker(): IFakeWorker {
  const log: IListenerLog = { closers: [], failers: [] };
  const stream = makeIdleStream(log);
  /**
   * Whether retirement has registered its close listener.
   * @returns True once registered.
   */
  const hasListener = (): boolean => log.closers.length > 0;
  /**
   * Fire the registered close listener, as the worker exiting would.
   * @returns The listener's result.
   */
  const close = (): boolean => log.closers[0]();
  /**
   * Make the worker report an error, as `ThreadStream` does when it fails.
   * @param message - The error message.
   * @returns The error listener's result.
   */
  const emitError = (message: string): boolean => log.failers[0](new ScraperError(message));
  return { stream, hasListener, close, emitError };
}

/**
 * Open a log file in a fresh directory and build the lease retirement receives.
 * @returns The directory and the lease on its `pipeline.log`.
 */
function openOwnedLease(): IOwnedLease {
  const dir = fs.mkdtempSync(DIR_PREFIX);
  const logFile = path.join(dir, 'pipeline.log');
  const fd = fs.openSync(logFile, 'a');
  const stats = fs.fstatSync(fd);
  const flags = { isFrozen: false, isClosing: false, isClosed: false };
  const lease: IFileLease = {
    fd,
    dev: stats.dev,
    ino: stats.ino,
    targetBytes: stats.size,
    ...flags,
  };
  return { dir, lease };
}

/**
 * Swallow a process warning; the watchdog warning is expected in this test.
 * @returns Always true.
 */
function silentWarning(): true {
  return true;
}

describe('scheduleStreamClose — who closes the shared descriptor', () => {
  it('[DSC-1] records the lease closed without closing the number after a graceful end', async () => {
    const { dir, lease } = openOwnedLease();
    const worker = makeFakeWorker();
    try {
      scheduleStreamClose(worker.stream, WAIT_MS, lease);
      const isListening = await awaitCondition(worker.hasListener, Date.now() + WAIT_MS);
      expect(isListening).toBe(true);
      worker.close();
      const isReleased = await awaitCondition((): boolean => lease.isClosed, Date.now() + WAIT_MS);
      expect(isReleased).toBe(true);
      const isOpen = isFdOpen(lease.fd);
      expect(isOpen).toBe(true);
    } finally {
      fs.closeSync(lease.fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[DSC-2] still closes the descriptor when the watchdog terminates the worker', async () => {
    const { dir, lease } = openOwnedLease();
    const worker = makeFakeWorker();
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(silentWarning);
    try {
      scheduleStreamClose(worker.stream, SHORT_WATCHDOG_MS, lease);
      const isReleased = await awaitCondition((): boolean => lease.isClosed, Date.now() + WAIT_MS);
      expect(isReleased).toBe(true);
      const isOpen = isFdOpen(lease.fd);
      expect(isOpen).toBe(false);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[DSC-3] still closes the descriptor when the worker failed before it closed', async () => {
    const { dir, lease } = openOwnedLease();
    const worker = makeFakeWorker();
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(silentWarning);
    try {
      scheduleStreamClose(worker.stream, WAIT_MS, lease);
      const isListening = await awaitCondition(worker.hasListener, Date.now() + WAIT_MS);
      expect(isListening).toBe(true);
      worker.emitError('disk full');
      worker.close();
      const isReleased = await awaitCondition((): boolean => lease.isClosed, Date.now() + WAIT_MS);
      expect(isReleased).toBe(true);
      const isOpen = isFdOpen(lease.fd);
      expect(isOpen).toBe(false);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[DSC-4] a stale-write error alone does not make a graceful end untrusted', async () => {
    const { dir, lease } = openOwnedLease();
    const worker = makeFakeWorker();
    try {
      scheduleStreamClose(worker.stream, WAIT_MS, lease);
      const isListening = await awaitCondition(worker.hasListener, Date.now() + WAIT_MS);
      expect(isListening).toBe(true);
      worker.emitError('the worker is ending');
      worker.close();
      const isReleased = await awaitCondition((): boolean => lease.isClosed, Date.now() + WAIT_MS);
      expect(isReleased).toBe(true);
      const isOpen = isFdOpen(lease.fd);
      expect(isOpen).toBe(true);
    } finally {
      fs.closeSync(lease.fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
