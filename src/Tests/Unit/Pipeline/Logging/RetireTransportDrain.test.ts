/**
 * Retirement must drain every transport destination, not only consume the
 * ring buffer.
 *
 * `ThreadStream.flush()` resolves once the worker copied its input; a buffered
 * `pino-pretty` target can still lose output if the worker is terminated at
 * that point. These specs pin the graceful end handshake (end marker -> each
 * destination flush + close -> worker exit) and the bounded termination
 * fallback when a destination never closes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';
import pino, { type Logger } from 'pino';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { type IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import { closeFileLeaseAsync } from '../../../../Scrapers/Pipeline/Logging/FileLeaseClose.js';
import {
  type IPinoStreamCandidate,
  scheduleStreamClose,
} from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import {
  requestWorkerEnd,
  type WorkerEndOutcome,
} from '../../../../Scrapers/Pipeline/Logging/RetireWorkerEnd.js';

const RECORD_COUNT = 40;

/** Worker end marker stored at `ThreadStream`'s `WRITE_INDEX` word. */
const END_MARKER = -1;

/** `WRITE_INDEX` word inside `ThreadStream`'s shared state. */
const WRITE_INDEX = 4;

/** `READ_INDEX` word inside `ThreadStream`'s shared state. */
const READ_INDEX = 8;

/** Bounded wait for a retired worker to close its destinations. */
const CLOSE_WAIT_MS = 5_000;

/** Event-loop poll interval while waiting for a worker condition. */
const POLL_MS = 10;

/** Minimal shape of a real Pino `ThreadStream` used by these specs. */
interface IThreadTransport {
  readonly closed: boolean;
  readonly destroyed: boolean;
  readonly worker: { readonly terminate: () => Promise<number> };
  on: (event: 'error', listener: (err: Error) => boolean) => object;
  once: (event: 'close', listener: () => boolean) => object;
  flush: (cb: (err?: Error) => boolean) => object;
}

/** Fake retired stream plus the knobs each spec inspects. */
interface IStreamProbe {
  readonly stream: IPinoStreamCandidate;
  readonly state: Int32Array;
  readonly terminateCalls: () => number;
  readonly emitClose: () => boolean;
  readonly setFlushing: (value: boolean) => boolean;
}

/**
 * Count non-empty lines written to `file`.
 * @param file - Destination file path.
 * @returns Number of written records.
 */
function countRecords(file: string): number {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  return lines.filter(Boolean).length;
}

/**
 * Yield event-loop turns until `predicate()` holds or the deadline expires.
 * @param predicate - Condition being awaited.
 * @param deadlineMs - Epoch-ms wall-clock deadline.
 * @returns True when the predicate held before the deadline.
 */
async function waitUntil(
  predicate: () => boolean,
  deadlineMs: number = Date.now() + CLOSE_WAIT_MS,
): Promise<boolean> {
  if (predicate()) return true;
  if (Date.now() >= deadlineMs) return false;
  await new Promise<true>(resolve => {
    setTimeout(resolve, POLL_MS, true);
  });
  return waitUntil(predicate, deadlineMs);
}

/**
 * Yield one event-loop turn after `delayMs`.
 * @param delayMs - Timer delay in milliseconds.
 * @returns Always true.
 */
async function yieldFor(delayMs: number): Promise<true> {
  return new Promise<true>(resolve => {
    setTimeout(resolve, delayMs, true);
  });
}

/**
 * Read the worker transport's `closed` flag.
 * @param transport - Pino worker transport.
 * @returns True once the worker has exited.
 */
function isTransportClosed(transport: object): boolean {
  const source = transport as IThreadTransport;
  return source.closed;
}

/**
 * Copy `ThreadStream`'s private `kImpl` state symbol onto the candidate so the
 * graceful-end handshake sees the same ring-buffer words as the real stream.
 * @param transport - Pino worker transport.
 * @param candidate - Retirement candidate built from `transport`.
 * @returns The same candidate, now carrying the private state record.
 */
function copyImplState(transport: object, candidate: IPinoStreamCandidate): IPinoStreamCandidate {
  const symbols = Object.getOwnPropertySymbols(transport);
  const implSymbol = symbols.find((symbol): boolean => symbol.description === 'kImpl');
  if (!implSymbol) return candidate;
  const impl = Reflect.get(transport, implSymbol) as object;
  Object.defineProperty(candidate, implSymbol, { value: impl });
  return candidate;
}

/**
 * Adapt a real `ThreadStream` to the retirement stream contract.
 * @param transport - Pino worker transport.
 * @returns Retirement candidate reading live transport state.
 */
function candidateOf(transport: object): IPinoStreamCandidate {
  const source = transport as IThreadTransport;
  const candidate: IPinoStreamCandidate = {
    closed: source.closed,
    destroyed: source.destroyed,
    /**
     * Detach the worker from the event loop.
     * @returns Always true.
     */
    unref: (): boolean => true,
    /**
     * Forward an error listener to the transport.
     * @param event - Event name.
     * @param listener - Error listener.
     * @returns The transport.
     */
    on: (event, listener): object => {
      source.on(event, listener);
      return source;
    },
    /**
     * Forward a close listener to the transport.
     * @param event - Event name.
     * @param listener - Close listener.
     * @returns The transport.
     */
    once: (event, listener): object => {
      source.once(event, listener);
      return source;
    },
    /**
     * Forward the async flush acknowledgement.
     * @param cb - Flush completion callback.
     * @returns The transport.
     */
    flush: (cb): object => {
      source.flush(cb);
      return source;
    },
    worker: source.worker,
  };
  return copyImplState(transport, candidate);
}

/** Mutable termination counter for a fake worker. */
interface ITerminationCounter {
  readonly count: () => number;
  readonly terminate: () => Promise<number>;
}

/** Close-listener registry for a fake retired stream. */
interface ICloseAwaiter {
  readonly register: (listener: () => boolean) => object;
  readonly emitClose: () => boolean;
}

/**
 * Build the termination counter used by a fake worker.
 * @returns Counter plus the `worker.terminate()` implementation.
 */
function makeTerminationCounter(): ITerminationCounter {
  let calls = 0;
  /**
   * Report how many times `worker.terminate()` ran.
   * @returns Termination call count.
   */
  const count = (): number => calls;
  /**
   * Record one `worker.terminate()` call.
   * @returns Resolved worker exit code.
   */
  const terminate = (): Promise<number> => {
    calls += 1;
    return Promise.resolve(0);
  };
  return { count, terminate };
}

/**
 * Build the close-listener registry used by a fake retired stream.
 * @returns Listener registrar plus the close trigger.
 */
function makeCloseAwaiter(): ICloseAwaiter {
  let listener: (() => boolean) | false = false;
  /**
   * Capture the retirement close listener.
   * @param next - Close listener registered by retirement.
   * @returns Dummy emitter object.
   */
  const register = (next: () => boolean): object => {
    listener = next;
    return {};
  };
  /**
   * Fire the captured `'close'` listener.
   * @returns True when a listener was registered.
   */
  const emitClose = (): boolean => (listener === false ? false : listener());
  return { register, emitClose };
}

/**
 * Build the stream object for a fake retired worker.
 * @param counter - Termination counter backing `worker.terminate()`.
 * @param closer - Registry capturing the retirement close listener.
 * @returns Minimal `ThreadStream`-shaped candidate.
 */
function makeProbeStream(
  counter: ITerminationCounter,
  closer: ICloseAwaiter,
): IPinoStreamCandidate {
  return {
    closed: false,
    destroyed: false,
    /**
     * Simulate `ThreadStream.unref()`.
     * @returns Always true.
     */
    unref: (): boolean => true,
    /**
     * Simulate `EventEmitter.on()`.
     * @returns Dummy emitter object.
     */
    on: (): object => ({}),
    /**
     * Capture the retirement close listener.
     * @param _event - Event name.
     * @param listener - Close listener.
     * @returns Dummy emitter object.
     */
    once: (_event, listener): object => closer.register(listener),
    worker: { terminate: counter.terminate },
  };
}

/**
 * Build a fake retired stream with an idle `ThreadStream` state record.
 * @returns Probe exposing the candidate, state words, and termination count.
 */
function makeStreamProbe(): IStreamProbe {
  const state = new Int32Array(32);
  const impl = { state, ending: false, flushing: false, buf: '' };
  const counter = makeTerminationCounter();
  const closer = makeCloseAwaiter();
  const stream = makeProbeStream(counter, closer);
  const implSymbol = Symbol('kImpl');
  /**
   * Flip the simulated `ThreadStream.nextFlush` claim.
   * @param value - New `flushing` flag.
   * @returns Always true.
   */
  const setFlushing = (value: boolean): boolean => {
    impl.flushing = value;
    return true;
  };
  Object.defineProperty(stream, implSymbol, { value: impl });
  return { stream, state, terminateCalls: counter.count, emitClose: closer.emitClose, setFlushing };
}

describe('requestWorkerEnd — graceful end handshake', () => {
  it('reports unsupported when the stream carries no ThreadStream state', () => {
    const outcome: WorkerEndOutcome = requestWorkerEnd({});
    expect(outcome).toBe('unsupported');
  });

  it('reports unsupported when the private state record is missing or malformed', () => {
    const implSymbol = Symbol('kImpl');
    const missingImpl = { [implSymbol]: null };
    const shortState = new Int32Array(8);
    const malformedImpl = {
      [implSymbol]: { state: shortState, ending: false, flushing: false, buf: '' },
    };
    const missingOutcome = requestWorkerEnd(missingImpl);
    expect(missingOutcome).toBe('unsupported');
    const malformedOutcome = requestWorkerEnd(malformedImpl);
    expect(malformedOutcome).toBe('unsupported');
  });

  it('reports busy while a queued nextFlush still owns the buffer', () => {
    const state = new Int32Array(32);
    const stream = { [Symbol('kImpl')]: { state, ending: false, flushing: true, buf: '' } };
    const outcome = requestWorkerEnd(stream);
    expect(outcome).toBe('busy');
  });

  it('reports busy until the worker consumes the ring buffer', () => {
    const state = new Int32Array(32);
    Atomics.store(state, WRITE_INDEX, 12);
    const stream = { [Symbol('kImpl')]: { state, ending: false, flushing: false, buf: '' } };
    const whileBuffered = requestWorkerEnd(stream);
    expect(whileBuffered).toBe('busy');
    Atomics.store(state, READ_INDEX, 12);
    const afterConsumed = requestWorkerEnd(stream);
    expect(afterConsumed).toBe('ended');
    const marker = Atomics.load(state, WRITE_INDEX);
    expect(marker).toBe(END_MARKER);
  });

  it('stores the end marker once the stream is idle', () => {
    const state = new Int32Array(32);
    const stream = { [Symbol('kImpl')]: { state, ending: false, flushing: false, buf: '' } };
    const before = Atomics.load(state, WRITE_INDEX);
    expect(before).toBe(0);
    const outcome = requestWorkerEnd(stream);
    expect(outcome).toBe('ended');
    const marker = Atomics.load(state, WRITE_INDEX);
    expect(marker).toBe(END_MARKER);
  });
});

describe('scheduleStreamClose — destination drain before termination', () => {
  it('flushes buffered pretty and file output before the worker exits', async () => {
    const tmpRoot = os.tmpdir();
    const dirPath = path.join(tmpRoot, 'retire-drain-');
    const dir = fs.mkdtempSync(dirPath);
    const prettyLog = path.join(dir, 'pretty.log');
    const fileLog = path.join(dir, 'file.log');
    fs.writeFileSync(prettyLog, '');
    fs.writeFileSync(fileLog, '');
    const fd = fs.openSync(fileLog, 'a');
    const stats = fs.fstatSync(fd);
    const lease = {
      fd,
      dev: stats.dev,
      ino: stats.ino,
      targetBytes: stats.size,
      isFrozen: false,
      isClosing: false,
      isClosed: false,
    };
    const warnings: string[] = [];
    /**
     * Record emitted process warnings without writing to stderr.
     * @param warning - Warning message or Error.
     * @returns Always true.
     */
    const recordWarning: typeof process.emitWarning = (warning): true => {
      const text = String(warning);
      warnings.push(text);
      return true;
    };
    const warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(recordWarning);
    const transport = pino.transport({
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: false, destination: prettyLog },
          level: 'trace',
        },
        { target: 'pino/file', options: { destination: fd }, level: 'trace' },
      ],
    });
    try {
      const logger = pino({ level: 'trace' }, transport);
      for (let idx = 0; idx < RECORD_COUNT; idx += 1) logger.info({ msg: `drain-${String(idx)}` });
      const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
      const stream = candidateOf(transport);
      retire.scheduleStreamClose(stream, CLOSE_WAIT_MS, lease);
      const isClosed = await waitUntil(
        (): boolean => isTransportClosed(transport) && lease.isClosed,
      );
      expect(isClosed).toBe(true);
      const prettyCount = countRecords(prettyLog);
      expect(prettyCount).toBe(RECORD_COUNT);
      const fileCount = countRecords(fileLog);
      expect(fileCount).toBe(RECORD_COUNT);
      expect(warnings).toEqual([]);
      // The worker's SonicBoom end closed the shared descriptor; main must not
      // close it again (EBADF / unrelated-fd reuse hazard).
      expect((): fs.Stats => fs.fstatSync(fd)).toThrow(/EBADF/u);
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('waits for the worker to close every destination before terminating', async () => {
    const probe = makeStreamProbe();
    const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
    retire.scheduleStreamClose(probe.stream, CLOSE_WAIT_MS);
    await yieldFor(POLL_MS * 5);
    const beforeClose = probe.terminateCalls();
    expect(beforeClose).toBe(0);
    const didRegisterListener = probe.emitClose();
    expect(didRegisterListener).toBe(true);
    const afterClose = probe.terminateCalls();
    expect(afterClose).toBe(1);
  });

  it('retries the end handshake while a queued flush still owns the buffer', async () => {
    const probe = makeStreamProbe();
    probe.setFlushing(true);
    const busyOutcome = requestWorkerEnd(probe.stream);
    expect(busyOutcome).toBe('busy');
    const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
    retire.scheduleStreamClose(probe.stream, CLOSE_WAIT_MS);
    await yieldFor(POLL_MS * 5);
    const busyMarker = Atomics.load(probe.state, WRITE_INDEX);
    expect(busyMarker).not.toBe(END_MARKER);
    probe.setFlushing(false);
    const didEnd = await waitUntil(
      (): boolean => Atomics.load(probe.state, WRITE_INDEX) === END_MARKER,
    );
    expect(didEnd).toBe(true);
    const callsBeforeClose = probe.terminateCalls();
    expect(callsBeforeClose).toBe(0);
    const didEmit = probe.emitClose();
    expect(didEmit).toBe(true);
    const callsAfterClose = probe.terminateCalls();
    expect(callsAfterClose).toBe(1);
  });

  it('falls back to the async flush when the stream has no end handshake', async () => {
    let didFlush = false;
    let terminateCalls = 0;
    const stream: IPinoStreamCandidate = {
      closed: false,
      destroyed: false,
      /**
       * Acknowledge the buffered records without the private end signal.
       * @param cb - Flush completion callback.
       * @returns Dummy stream object.
       */
      flush: (cb): object => {
        didFlush = true;
        cb();
        return {};
      },
      /**
       * Simulate `ThreadStream.unref()`.
       * @returns Always true.
       */
      unref: (): boolean => true,
      /**
       * Simulate `EventEmitter.on()`.
       * @returns Dummy emitter object.
       */
      on: (): object => ({}),
      worker: {
        /**
         * Record one `worker.terminate()` call.
         * @returns Resolved worker exit code.
         */
        terminate: (): Promise<number> => {
          terminateCalls += 1;
          return Promise.resolve(0);
        },
      },
    };
    const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
    retire.scheduleStreamClose(stream, CLOSE_WAIT_MS);
    const didTerminate = await waitUntil((): boolean => terminateCalls > 0);
    expect(didTerminate).toBe(true);
    expect(didFlush).toBe(true);
    expect(terminateCalls).toBe(1);
  });

  it('settles an already-closed stream without terminating it', async () => {
    let terminateCalls = 0;
    const stream: IPinoStreamCandidate = {
      closed: true,
      destroyed: false,
      worker: {
        /**
         * Record an unexpected `worker.terminate()` call.
         * @returns Resolved worker exit code.
         */
        terminate: (): Promise<number> => {
          terminateCalls += 1;
          return Promise.resolve(0);
        },
      },
    };
    const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
    retire.scheduleStreamClose(stream);
    await yieldFor(POLL_MS * 2);
    expect(terminateCalls).toBe(0);
  });

  it('ignores a superseded logger whose stream is not retirable', async () => {
    /**
     * Build a superseded logger whose Pino stream is `stream`.
     * @param stream - Value stored under `pino.symbols.streamSym`.
     * @returns Logger whose stream is the supplied stand-in.
     */
    const previousWith = (stream: object): Logger => {
      const sink = {
        /**
         * Discard serialized records from the silent probe logger.
         * @returns Always true.
         */
        write: (): boolean => true,
      };
      const previous = pino({ level: 'silent' }, sink);
      Object.defineProperty(previous, pino.symbols.streamSym, { value: stream });
      return previous;
    };
    const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
    const stdoutLike = previousWith({ fd: 1 });
    const flushSpy = jest.spyOn(stdoutLike, 'flush');
    const stdoutResult = retire.retireSupersededLogger(stdoutLike, false);
    expect(stdoutResult).toBe(false);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    const emptyStreamLogger = previousWith({});
    const emptyResult = retire.retireSupersededLogger(emptyStreamLogger, false);
    expect(emptyResult).toBe(false);
    const workerOnlyLogger = previousWith({ worker: {} });
    const workerResult = retire.retireSupersededLogger(workerOnlyLogger, false);
    expect(workerResult).toBe(false);
    const absentResult = retire.retireSupersededLogger(false, false);
    expect(absentResult).toBe(false);
  });

  it('terminates a worker whose destinations never close after the end request', async () => {
    const warnings: string[] = [];
    /**
     * Record emitted process warnings without writing to stderr.
     * @param warning - Warning message or Error.
     * @returns Always true.
     */
    const recordWarning: typeof process.emitWarning = (warning): true => {
      const text = String(warning);
      warnings.push(text);
      return true;
    };
    const warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(recordWarning);
    const probe = makeStreamProbe();
    try {
      const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
      retire.scheduleStreamClose(probe.stream, 30);
      const hasTerminated = await waitUntil((): boolean => probe.terminateCalls() > 0);
      expect(hasTerminated).toBe(true);
      const marker = Atomics.load(probe.state, WRITE_INDEX);
      expect(marker).toBe(END_MARKER);
      const hasTimeout = warnings.some(msg => msg.includes('worker drain timed out'));
      expect(hasTimeout).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/**
 * Open `file` in append mode and build the owned lease retirement receives.
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

/** Temporary directory plus the lease on its `pipeline.log`. */
interface IOwnedLease {
  readonly dir: string;
  readonly lease: IFileLease;
}

/**
 * Create a temporary directory and open a lease on its `pipeline.log`.
 * @returns Temporary directory and the lease on its log file.
 */
function makeOwnedLease(): IOwnedLease {
  const tmpRoot = os.tmpdir();
  const prefixPath = path.join(tmpRoot, 'lease-own-');
  const dir = fs.mkdtempSync(prefixPath);
  const logFile = path.join(dir, 'pipeline.log');
  return { dir, lease: openLease(logFile) };
}

describe('closeFileLeaseAsync — shared descriptor ownership', () => {
  it('closes the descriptor once when the worker never did', async () => {
    const { dir, lease } = makeOwnedLease();
    const onCloseError = jest.fn<boolean, [string]>((): boolean => true);
    try {
      const didSchedule = closeFileLeaseAsync(lease, onCloseError);
      expect(didSchedule).toBe(true);
      const isClosed = await waitUntil((): boolean => lease.isClosed);
      expect(isClosed).toBe(true);
      expect((): fs.Stats => fs.fstatSync(lease.fd)).toThrow(/EBADF/u);
      expect(onCloseError).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a descriptor the worker already closed as closed', () => {
    const { dir, lease } = makeOwnedLease();
    const onCloseError = jest.fn<boolean, [string]>((): boolean => true);
    try {
      fs.closeSync(lease.fd);
      const didSchedule = closeFileLeaseAsync(lease, onCloseError);
      expect(didSchedule).toBe(false);
      expect(lease.isClosed).toBe(true);
      expect(onCloseError).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never closes a descriptor number reused by another file', () => {
    const { dir, lease } = makeOwnedLease();
    const onCloseError = jest.fn<boolean, [string]>((): boolean => true);
    try {
      fs.closeSync(lease.fd);
      // The kernel hands the lowest free number to the next open, so this
      // reuses `lease.fd` for a different inode.
      const otherPath = path.join(dir, 'other.log');
      const reused = fs.openSync(otherPath, 'w');
      expect(reused).toBe(lease.fd);
      const didSchedule = closeFileLeaseAsync(lease, onCloseError);
      expect(didSchedule).toBe(false);
      expect(lease.isClosed).toBe(true);
      expect(fs.fstatSync(reused).size).toBe(0);
      expect(onCloseError).not.toHaveBeenCalled();
      fs.closeSync(reused);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Short watchdog (ms) bounding a fallback whose lease bytes never arrive. */
const SHORT_WATCHDOG_MS = 50;

/** Bytes a lease claims were written but that never reach the file. */
const MISSING_BYTES = 64;

/** Flush callback retirement hands a fallback stream. */
type FlushCallback = (flushError?: Error) => boolean;

/** Fake fallback stream whose `flush` acknowledgement the spec triggers by hand. */
interface IFlushProbe {
  readonly stream: IPinoStreamCandidate;
  readonly terminateCalls: () => number;
  readonly acknowledge: FlushCallback;
}

/** One `kImpl` shape retirement must refuse rather than write the end marker into. */
interface IUnsupportedLayout {
  readonly id: string;
  readonly name: string;
  readonly impl: object | false;
  readonly watched: ArrayLike<number> | false;
}

/**
 * Yield one `setImmediate` turn; anything queued earlier has already run.
 * @returns Always true.
 */
function yieldImmediate(): Promise<true> {
  return new Promise<true>(resolve => {
    setImmediate(resolve, true);
  });
}

/**
 * Record `process.emitWarning` calls instead of writing them to stderr.
 * @returns Recorded warnings plus the restore hook.
 */
function captureWarnings(): { readonly warnings: string[]; readonly restore: () => true } {
  const warnings: string[] = [];
  /**
   * Record one emitted warning.
   * @param warning - Warning message or Error.
   * @returns Always true.
   */
  const record: typeof process.emitWarning = (warning): true => {
    const text = String(warning);
    warnings.push(text);
    return true;
  };
  const spy = jest.spyOn(process, 'emitWarning').mockImplementation(record);
  /**
   * Restore the real `process.emitWarning`.
   * @returns Always true.
   */
  const restore = (): true => {
    spy.mockRestore();
    return true;
  };
  return { warnings, restore };
}

/**
 * Build a fake fallback stream: no private end signal, hand-driven flush.
 * @returns Probe exposing the candidate, flush hooks, and termination count.
 */
function makeFlushProbe(): IFlushProbe {
  const counter = makeTerminationCounter();
  let pending: FlushCallback | false = false;
  const stream: IPinoStreamCandidate = {
    closed: false,
    destroyed: false,
    /**
     * Hold the callback retirement passed to `flush`.
     * @param cb - Flush completion callback.
     * @returns Dummy stream object.
     */
    flush: (cb): object => {
      pending = cb;
      return {};
    },
    worker: { terminate: counter.terminate },
  };
  /**
   * Fire the held flush callback.
   * @param flushError - Optional flush failure.
   * @returns True when a callback was held and ran.
   */
  const acknowledge: FlushCallback = (flushError): boolean =>
    pending === false ? false : pending(flushError);
  return { stream, terminateCalls: counter.count, acknowledge };
}

/**
 * Build the unsupported `kImpl` layouts the fallback must tolerate.
 * @returns One row per layout, each with fresh state arrays.
 */
function makeUnsupportedLayouts(): readonly IUnsupportedLayout[] {
  const renamed = new Int32Array(32);
  const short = new Int32Array(READ_INDEX);
  const bytes = new Uint8Array(128);
  const flags = { ending: false, flushing: false, buf: '' };
  const moved = { sab: renamed, isEnding: false, isFlushing: false, pending: '' };
  return [
    { id: 'RTC-8a', name: 'no kImpl symbol', impl: false, watched: false },
    { id: 'RTC-8b', name: 'an empty kImpl record', impl: {}, watched: false },
    { id: 'RTC-8c', name: 'renamed state fields', impl: moved, watched: renamed },
    {
      id: 'RTC-8d',
      name: 'a state too short for READ_INDEX',
      impl: { ...flags, state: short },
      watched: short,
    },
    {
      id: 'RTC-8e',
      name: 'a non-Int32Array state',
      impl: { ...flags, state: bytes },
      watched: bytes,
    },
  ];
}

/** Every unsupported `kImpl` layout, built once so each row owns its state arrays. */
const UNSUPPORTED_LAYOUTS = makeUnsupportedLayouts();

/**
 * Unsupported private layout: what the fallback does and what it can prove.
 *
 * `requestWorkerEnd` only trusts a `kImpl` record whose SHAPE matches
 * `ThreadStream` (Int32Array state longer than READ_INDEX, boolean flags, string
 * buf). Anything else reports `unsupported`, and retirement then NEVER stores the
 * end marker. It waits for `flush()` (the worker consumed the ring buffer), then
 * for the owned lease (`fstat` size reaches the counted bytes), then calls
 * `worker.terminate()`. The real-worker variant is RTC-3 in
 * RetireTransportCompat.test.ts.
 *
 * - CAN be proven drained: `pino/file` destinations on an owned lease, because the
 *   main thread counts the serialized bytes and polls the shared descriptor.
 * - CANNOT be proven drained: `pino-pretty` or multistream targets and any
 *   lease-less destination. The flush acknowledgement only says the worker copied
 *   the bytes, so terminating can drop output still buffered inside those
 *   destinations. The watchdog bounds a lease that never reaches its target.
 *
 * Known limit: the guard checks shape, not meaning. A future layout with the same
 * field names and types but moved offsets is not detected at runtime, which is why
 * the pinned graph, RTC-2 and the packed-consumer probe verify the offsets instead.
 */
describe('unsupported thread-stream layout fallback', () => {
  it.each(UNSUPPORTED_LAYOUTS)(
    '[$id] $name falls back to flush then terminate and never writes shared state',
    async (row): Promise<void> => {
      const probe = makeFlushProbe();
      const implSymbol = Symbol('kImpl');
      if (row.impl) Object.defineProperty(probe.stream, implSymbol, { value: row.impl });
      const outcome = requestWorkerEnd(probe.stream);
      expect(outcome).toBe('unsupported');
      scheduleStreamClose(probe.stream, CLOSE_WAIT_MS);
      await yieldImmediate();
      const beforeAck = probe.terminateCalls();
      expect(beforeAck).toBe(0);
      probe.acknowledge();
      const afterAck = probe.terminateCalls();
      expect(afterAck).toBe(1);
      const words = row.watched ? Array.from(row.watched) : [];
      const isUntouched = words.every((word): boolean => word === 0);
      expect(isUntouched).toBe(true);
    },
  );

  it('[RTC-9] an owned lease holds the fallback until the counted bytes are on disk, else the watchdog fires', async () => {
    const { dir, lease } = makeOwnedLease();
    lease.targetBytes += MISSING_BYTES;
    const recorder = captureWarnings();
    const probe = makeFlushProbe();
    try {
      scheduleStreamClose(probe.stream, SHORT_WATCHDOG_MS, lease);
      await yieldImmediate();
      probe.acknowledge();
      // A lease-less fallback terminates synchronously here (RTC-10); a lease must wait.
      const afterAck = probe.terminateCalls();
      expect(afterAck).toBe(0);
      const hasTerminated = await waitUntil((): boolean => probe.terminateCalls() > 0);
      expect(hasTerminated).toBe(true);
      const hasTimeout = recorder.warnings.some(msg => msg.includes('worker drain timed out'));
      expect(hasTimeout).toBe(true);
      const isClosed = await waitUntil((): boolean => lease.isClosed);
      expect(isClosed).toBe(true);
      expect((): fs.Stats => fs.fstatSync(lease.fd)).toThrow(/EBADF/u);
    } finally {
      recorder.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[RTC-10] without an owned lease the fallback settles on the flush acknowledgement alone', async () => {
    const recorder = captureWarnings();
    const probe = makeFlushProbe();
    try {
      scheduleStreamClose(probe.stream, CLOSE_WAIT_MS);
      await yieldImmediate();
      const beforeAck = probe.terminateCalls();
      expect(beforeAck).toBe(0);
      probe.acknowledge();
      // Nothing proves the destinations drained; the acknowledgement is the only evidence.
      const afterAck = probe.terminateCalls();
      expect(afterAck).toBe(1);
      expect(recorder.warnings).toEqual([]);
    } finally {
      recorder.restore();
    }
  });

  it('[RTC-11] a failed fallback flush is reported out-of-band and the worker is still terminated', async () => {
    const recorder = captureWarnings();
    const probe = makeFlushProbe();
    try {
      scheduleStreamClose(probe.stream, CLOSE_WAIT_MS);
      await yieldImmediate();
      const flushError = new ScraperError('flush rejected');
      probe.acknowledge(flushError);
      const afterAck = probe.terminateCalls();
      expect(afterAck).toBe(1);
      const reported = ['superseded log transport failed while draining: flush rejected'];
      expect(recorder.warnings).toEqual(reported);
    } finally {
      recorder.restore();
    }
  });
});
