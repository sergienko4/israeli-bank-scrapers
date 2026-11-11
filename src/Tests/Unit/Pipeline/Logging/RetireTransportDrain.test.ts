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

import { type IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import { closeFileLeaseAsync } from '../../../../Scrapers/Pipeline/Logging/FileLeaseClose.js';
import type { IPinoStreamCandidate } from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
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
    const malformedImpl = { [implSymbol]: { state: shortState } };
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
