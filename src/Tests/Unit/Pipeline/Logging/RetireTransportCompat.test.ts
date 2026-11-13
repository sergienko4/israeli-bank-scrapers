/**
 * Worker retirement against the REAL installed pino and thread-stream.
 *
 * Retirement writes `ThreadStream`'s private `kImpl` shared-state protocol
 * (fixed word offsets, a `-1` end marker). That layout is not a public contract,
 * so these specs run the production retirement over unmocked worker-backed
 * transports: a different supported pino/thread-stream version that stops
 * matching the layout fails here instead of silently losing log records.
 *
 * The fake-stream handshake, malformed-state, pretty/file drain, watchdog and
 * fallback-limit specs live in RetireTransportDrain.test.ts.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';
import pino, { type Logger } from 'pino';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import {
  type IFileLease,
  type ILeasedLoggerHooks,
  instantiateLeasedFileLogger,
} from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import { retireSupersededLogger } from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import { requestWorkerEnd } from '../../../../Scrapers/Pipeline/Logging/RetireWorkerEnd.js';

/** Worker end marker `RetireWorkerEnd` stores at `WRITE_INDEX`. */
const END_MARKER = -1;

/** `WRITE_INDEX` word `RetireWorkerEnd` writes; RTC-2 ties it to the installed thread-stream. */
const WRITE_INDEX = 4;

/** `READ_INDEX` word `RetireWorkerEnd` reads; RTC-2 ties it to the installed thread-stream. */
const READ_INDEX = 8;

/** Records written through the real worker in each spec. */
const RECORD_COUNT = 25;

/** Create-write-retire cycles proving descriptor ownership and worker release. */
const CYCLE_COUNT = 5;

/** Event-loop turns the sentinel must complete while retirement is still pending. */
const SENTINEL_TURNS = 3;

/** Offsets `thread-stream` publishes in `lib/indexes.js`. */
type ThreadStreamIndexes = Readonly<Record<'WRITE_INDEX' | 'READ_INDEX', number>>;

/** Minimal shape of a real Pino `ThreadStream` used by these specs. */
interface IThreadTransport {
  readonly closed: boolean;
  readonly destroyed: boolean;
  readonly worker: {
    readonly terminate: () => Promise<number>;
    /** Node reports `-1` once the worker thread has stopped. */
    readonly threadId: number;
  };
  once: (event: 'close' | 'ready', listener: () => boolean) => object;
  /** Blocking `Atomics.wait` end; the real method returns nothing, so callers ignore the value. */
  end: () => boolean;
}

/** Private `ThreadStream` state record (`kImpl`) the end handshake depends on. */
interface IThreadImpl {
  readonly state: Int32Array;
  readonly buf: string;
  readonly flushing: boolean;
  readonly ending: boolean;
}

/** Real worker-backed `pipeline.log` logger with its owned lease. */
interface IRealWorker {
  readonly file: string;
  readonly logger: Logger;
  readonly lease: IFileLease;
  readonly transport: IThreadTransport;
}

/** Recorder replacing `process.emitWarning`. */
interface IWarningSpy {
  readonly warnings: string[];
  readonly restore: () => true;
}

/** One pending barrier released by the sentinel once `isDone()` holds. */
interface IWaiter {
  readonly isDone: () => boolean;
  readonly release: () => true;
}

/** Self-rescheduling `setImmediate` loop counting event-loop turns. */
interface ISentinel {
  ticks: number;
  isRunning: boolean;
  waiter: IWaiter | false;
}

/**
 * Create a scratch directory under the OS temp root.
 * @returns Absolute directory path owned by the calling spec.
 */
function makeScratchDir(): string {
  const tmpRoot = os.tmpdir();
  const prefix = path.join(tmpRoot, 'retire-compat-');
  return fs.mkdtempSync(prefix);
}

/**
 * Record `process.emitWarning` calls instead of writing them to stderr.
 * @returns Recorded warnings plus the restore hook.
 */
function spyOnWarnings(): IWarningSpy {
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
 * Build production-shaped `pino/file` options for a leased descriptor.
 * @param fd - Owned append descriptor shared with the worker.
 * @returns Pino options routing through a worker-backed file transport.
 */
function buildFileOptions(fd: number): pino.LoggerOptions {
  const transport = { target: 'pino/file', options: { destination: fd } };
  return { level: 'info', transport };
}

/**
 * Refuse silent degradation: a fallback logger would pass the specs without a worker.
 * @param error - Transport construction failure.
 * @returns Never returns.
 */
function rejectDegrade(error: Error): never {
  throw new ScraperError(error.message);
}

/**
 * Build the production lease hooks around the real file transport.
 * @param logFile - Resolved `pipeline.log` path.
 * @returns Hooks for `instantiateLeasedFileLogger`.
 */
function makeLeasedHooks(logFile: string): ILeasedLoggerHooks {
  return {
    logFile,
    buildPreferredOptions: buildFileOptions,
    buildFallbackOptions: buildFileOptions,
    onTransportFailure: rejectDegrade,
    buildSilentFallback: rejectDegrade,
  };
}

/**
 * Build the production leased logger over the installed pino and thread-stream.
 * @param dir - Scratch directory holding the log file.
 * @param name - Log file name inside `dir`.
 * @returns Real worker-backed logger, lease, and worker transport.
 */
function startRealWorker(dir: string, name = 'pipeline.log'): IRealWorker {
  const file = path.join(dir, name);
  const hooks = makeLeasedHooks(file);
  const { logger, lease } = instantiateLeasedFileLogger(hooks);
  if (!lease) throw new ScraperError('expected an owned lease for the real worker logger');
  const transport = Reflect.get(logger, pino.symbols.streamSym) as IThreadTransport;
  return { file, logger, lease, transport };
}

/**
 * Write numbered records through `logger`.
 * @param logger - Real worker-backed logger.
 * @param count - Number of records to write.
 * @returns The expected messages, in write order.
 */
function writeRecords(logger: Logger, count: number): string[] {
  const expected: string[] = [];
  for (let idx = 0; idx < count; idx += 1) {
    const message = `compat-${String(idx)}`;
    logger.info(message);
    expected.push(message);
  }
  return expected;
}

/**
 * Read the `msg` field of every record on disk, in order.
 * @param file - Log file path.
 * @returns Messages present in `file`.
 */
function readMessages(file: string): string[] {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return lines.map((line): string => (JSON.parse(line) as { msg: string }).msg);
}

/**
 * Read `ThreadStream`'s private state record off a real transport.
 * @param transport - Real worker transport.
 * @returns The `kImpl` record, or `false` when this layout has none.
 */
function readImpl(transport: object): IThreadImpl | false {
  const symbols = Object.getOwnPropertySymbols(transport);
  const implSymbol = symbols.find((symbol): boolean => symbol.description === 'kImpl');
  if (!implSymbol) return false;
  return Reflect.get(transport, implSymbol) as IThreadImpl;
}

/**
 * Count characters `ThreadStream` still buffers on the main thread.
 * @param transport - Real worker transport.
 * @returns Buffered character count, or `-1` when no state record exists.
 */
function bufferedChars(transport: object): number {
  const impl = readImpl(transport);
  return impl ? impl.buf.length : -1;
}

/**
 * Read the shared `WRITE_INDEX` word.
 * @param transport - Real worker transport.
 * @returns The word, or `0` when no state record exists.
 */
function readWriteIndex(transport: object): number {
  const impl = readImpl(transport);
  return impl ? Atomics.load(impl.state, WRITE_INDEX) : 0;
}

/**
 * Hold or release the "a queued flush still owns the buffer" state on a real stream.
 * @param transport - Real worker transport.
 * @param value - New `flushing` flag.
 * @returns True when the flag was written.
 */
function setFlushing(transport: object, value: boolean): boolean {
  const impl = readImpl(transport);
  return impl ? Reflect.set(impl, 'flushing', value) : false;
}

/**
 * Make a real stream look like a different layout: the `kImpl` symbol is no longer
 * discoverable among its own keys, while every internal access still works.
 * @param transport - Real worker transport.
 * @returns Proxy over `transport` that hides the private state symbol.
 */
function hideImplSymbol(transport: IThreadTransport): IThreadTransport {
  /**
   * List own keys without the private state symbol.
   * @param target - Proxied transport.
   * @returns Own keys minus `kImpl`.
   */
  const ownKeys = (target: object): (string | symbol)[] =>
    Reflect.ownKeys(target).filter(
      (key): boolean => typeof key === 'string' || key.description !== 'kImpl',
    );
  return new Proxy<IThreadTransport>(transport, { ownKeys });
}

/**
 * Resolve once `transport` emits `close` (listener registered before retirement).
 * @param transport - Real worker transport.
 * @param sentinel - Optional sentinel sampled at the moment of the event.
 * @returns Sentinel ticks (or 0 without a sentinel) when the worker closed.
 */
function whenClosed(transport: IThreadTransport, sentinel?: ISentinel): Promise<number> {
  return new Promise<number>(resolve => {
    transport.once('close', (): boolean => {
      resolve(sentinel ? sentinel.ticks : 0);
      return true;
    });
  });
}

/**
 * Resolve once `transport` emits `ready` (the worker finished booting).
 * @param transport - Real worker transport.
 * @returns Always true.
 */
function whenReady(transport: IThreadTransport): Promise<true> {
  return new Promise<true>(resolve => {
    transport.once('ready', (): boolean => {
      resolve(true);
      return true;
    });
  });
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
 * Count one event-loop turn and re-arm, releasing a waiting barrier once it holds.
 * @param sentinel - Mutable sentinel state.
 * @returns Always true.
 */
function tickSentinel(sentinel: ISentinel): true {
  if (!sentinel.isRunning) return true;
  sentinel.ticks += 1;
  const { waiter } = sentinel;
  if (waiter && waiter.isDone()) {
    sentinel.waiter = false;
    waiter.release();
  }
  setImmediate(tickSentinel, sentinel);
  return true;
}

/**
 * Start a sentinel that counts event-loop turns until stopped.
 * @returns Running sentinel.
 */
function startSentinel(): ISentinel {
  const sentinel: ISentinel = { ticks: 0, isRunning: true, waiter: false };
  setImmediate(tickSentinel, sentinel);
  return sentinel;
}

/**
 * Resolve at the first loop turn where `isDone()` holds (an explicit barrier).
 * @param sentinel - Running sentinel.
 * @param isDone - Condition checked once per event-loop turn.
 * @returns Always true.
 */
function awaitCondition(sentinel: ISentinel, isDone: () => boolean): Promise<true> {
  return new Promise<true>(resolve => {
    /**
     * Release the awaiting spec.
     * @returns Always true.
     */
    const release = (): true => {
      resolve(true);
      return true;
    };
    sentinel.waiter = { isDone, release };
  });
}

/**
 * Resolve once the sentinel completes `turns` more event-loop turns.
 * @param sentinel - Running sentinel.
 * @param turns - Turns to wait for.
 * @returns Always true.
 */
function awaitTurns(sentinel: ISentinel, turns: number): Promise<true> {
  const target = sentinel.ticks + turns;
  return awaitCondition(sentinel, (): boolean => sentinel.ticks >= target);
}

/**
 * Stop a sentinel so it never outlives its spec.
 * @param sentinel - Running sentinel.
 * @returns Always true.
 */
function stopSentinel(sentinel: ISentinel): true {
  sentinel.isRunning = false;
  return true;
}

/**
 * Check whether a lease descriptor no longer names the leased log file.
 * @param lease - Owned file lease.
 * @returns True when the descriptor is closed or reused by another file.
 */
function isFdReleased(lease: IFileLease): boolean {
  try {
    const stats = fs.fstatSync(lease.fd);
    return stats.dev !== lease.dev || stats.ino !== lease.ino;
  } catch {
    return true;
  }
}

/**
 * Load the offsets the installed `thread-stream` itself publishes.
 * @returns `WRITE_INDEX` and `READ_INDEX` as resolved from the installed pino.
 */
function loadThreadStreamIndexes(): ThreadStreamIndexes {
  const fromRepo = createRequire(import.meta.url);
  const pinoManifest = fromRepo.resolve('pino/package.json');
  const fromPino = createRequire(pinoManifest);
  return fromPino('thread-stream/lib/indexes.js') as ThreadStreamIndexes;
}

describe('worker retirement over the installed pino and thread-stream', () => {
  it('[RTC-1] retires a real worker through the production entry point with every record on disk', async () => {
    const dir = makeScratchDir();
    const warnings = spyOnWarnings();
    try {
      const real = startRealWorker(dir);
      const terminateSpy = jest.spyOn(real.transport.worker, 'terminate');
      const closed = whenClosed(real.transport);
      const expected = writeRecords(real.logger, RECORD_COUNT);
      const didRetire = retireSupersededLogger(real.logger, real.lease);
      expect(didRetire).toBe(true);
      await closed;
      const messages = readMessages(real.file);
      expect(messages).toEqual(expected);
      // Graceful end: the worker exited by itself and closed the shared fd, so
      // retirement neither terminated it nor issued a second `fs.close`.
      expect(terminateSpy).not.toHaveBeenCalled();
      expect(real.transport.worker.threadId).toBe(-1);
      expect(real.lease.isClosed).toBe(true);
      expect(real.lease.isClosing).toBe(false);
      const isReleased = isFdReleased(real.lease);
      expect(isReleased).toBe(true);
      expect(warnings.warnings).toEqual([]);
    } finally {
      warnings.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[RTC-2] the installed thread-stream keeps the kImpl layout and offsets retirement writes', async () => {
    const dir = makeScratchDir();
    try {
      const indexes = loadThreadStreamIndexes();
      expect(indexes).toEqual({ WRITE_INDEX, READ_INDEX });
      const real = startRealWorker(dir);
      const closed = whenClosed(real.transport);
      const impl = readImpl(real.transport);
      expect(impl).toMatchObject({ ending: false, flushing: false, buf: '' });
      expect(impl && impl.state).toBeInstanceOf(Int32Array);
      expect(impl && impl.state.length).toBeGreaterThan(READ_INDEX);
      const outcome = requestWorkerEnd(real.transport);
      expect(outcome).toBe('ended');
      await closed;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Unsupported layout, real worker: the stream looks like a thread-stream whose
   * private state cannot be found. Retirement must not guess offsets; it flushes,
   * waits for the owned lease's counted bytes, then terminates and closes the fd
   * itself. The fake-stream layout variants and fallback limits are RTC-8 to RTC-11 in
   * RetireTransportDrain.test.ts.
   */
  it('[RTC-3] drains a real worker without a discoverable kImpl through flush and the lease before terminating', async () => {
    const dir = makeScratchDir();
    const warnings = spyOnWarnings();
    const sentinel = startSentinel();
    try {
      const real = startRealWorker(dir);
      const terminateSpy = jest.spyOn(real.transport.worker, 'terminate');
      const hidden = hideImplSymbol(real.transport);
      const outcome = requestWorkerEnd(hidden);
      expect(outcome).toBe('unsupported');
      Object.defineProperty(real.logger, pino.symbols.streamSym, { value: hidden });
      const expected = writeRecords(real.logger, RECORD_COUNT);
      const didRetire = retireSupersededLogger(real.logger, real.lease);
      expect(didRetire).toBe(true);
      await awaitCondition(sentinel, (): boolean => real.transport.closed && real.lease.isClosed);
      const messages = readMessages(real.file);
      expect(messages).toEqual(expected);
      expect(terminateSpy).toHaveBeenCalledTimes(1);
      expect(real.lease.isClosing).toBe(true);
      const isReleased = isFdReleased(real.lease);
      expect(isReleased).toBe(true);
      expect(warnings.warnings).toEqual([]);
    } finally {
      stopSentinel(sentinel);
      warnings.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('worker retirement never blocks the event loop', () => {
  it('[RTC-4] retires a real worker with buffered output while the loop keeps turning and never calls Atomics.wait', async () => {
    const dir = makeScratchDir();
    const warnings = spyOnWarnings();
    const waitSpy = jest.spyOn(Atomics, 'wait');
    const sentinel = startSentinel();
    try {
      const real = startRealWorker(dir);
      const expected = writeRecords(real.logger, RECORD_COUNT);
      const buffered = bufferedChars(real.transport);
      expect(buffered).toBeGreaterThan(0);
      const closed = whenClosed(real.transport, sentinel);
      const ticksAtCall = sentinel.ticks;
      waitSpy.mockClear();
      const didRetire = retireSupersededLogger(real.logger, real.lease);
      expect(didRetire).toBe(true);
      const ticksAtClose = await closed;
      expect(ticksAtClose).toBeGreaterThan(ticksAtCall);
      expect(waitSpy).not.toHaveBeenCalled();
      const messages = readMessages(real.file);
      expect(messages).toEqual(expected);
    } finally {
      stopSentinel(sentinel);
      waitSpy.mockRestore();
      warnings.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[RTC-5] control: the blocking ThreadStream.end() retirement avoids does call Atomics.wait', async () => {
    const dir = makeScratchDir();
    const waitSpy = jest.spyOn(Atomics, 'wait');
    try {
      const real = startRealWorker(dir);
      const ready = whenReady(real.transport);
      const closed = whenClosed(real.transport);
      await ready;
      waitSpy.mockClear();
      real.transport.end();
      expect(waitSpy).toHaveBeenCalled();
      await closed;
    } finally {
      waitSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[RTC-6] the loop completes several turns while retirement waits on a busy real worker', async () => {
    const dir = makeScratchDir();
    const warnings = spyOnWarnings();
    const sentinel = startSentinel();
    try {
      const real = startRealWorker(dir);
      const expected = writeRecords(real.logger, RECORD_COUNT);
      // `ThreadStream` moves its buffer into the ring on its first immediate; hold
      // the "queued flush owns the buffer" state afterwards so retirement must wait.
      await yieldImmediate();
      const isHeld = setFlushing(real.transport, true);
      expect(isHeld).toBe(true);
      const closed = whenClosed(real.transport);
      const didRetire = retireSupersededLogger(real.logger, real.lease);
      expect(didRetire).toBe(true);
      // Barrier: only a loop that keeps turning reaches it. A retirement that spun or
      // blocked while busy would starve the sentinel and never release it.
      await awaitTurns(sentinel, SENTINEL_TURNS);
      const pendingMarker = readWriteIndex(real.transport);
      expect(pendingMarker).not.toBe(END_MARKER);
      expect(real.transport.closed).toBe(false);
      setFlushing(real.transport, false);
      await closed;
      const messages = readMessages(real.file);
      expect(messages).toEqual(expected);
    } finally {
      stopSentinel(sentinel);
      warnings.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Outcome of one create-write-retire cycle. */
interface ICycleResult {
  readonly real: IRealWorker;
  readonly expected: string[];
  readonly didRetire: boolean;
  readonly isFdClosedAtClose: boolean;
}

/**
 * Run one create-write-retire cycle against the real worker.
 * @param dir - Scratch directory holding the cycle's log file.
 * @param idx - Cycle number, used for the file name.
 * @returns Cycle evidence sampled at the moment the worker closed.
 */
async function runCycle(dir: string, idx: number): Promise<ICycleResult> {
  const name = `cycle-${String(idx)}.log`;
  const real = startRealWorker(dir, name);
  const closed = whenClosed(real.transport);
  const expected = writeRecords(real.logger, RECORD_COUNT);
  const didRetire = retireSupersededLogger(real.logger, real.lease);
  await closed;
  const isFdClosedAtClose = isFdReleased(real.lease);
  return { real, expected, didRetire, isFdClosedAtClose };
}

/**
 * Run `remaining` sequential cycles (each must finish before the next starts).
 * @param dir - Scratch directory holding the log files.
 * @param remaining - Cycles still to run.
 * @param done - Results gathered so far.
 * @returns Every cycle's evidence, in order.
 */
async function runCycles(
  dir: string,
  remaining: number,
  done: readonly ICycleResult[] = [],
): Promise<readonly ICycleResult[]> {
  if (remaining === 0) return done;
  const result = await runCycle(dir, done.length);
  return runCycles(dir, remaining - 1, [...done, result]);
}

describe('repeated worker retirement', () => {
  it('[RTC-7] closes every leased descriptor and retains no worker across repeated cycles', async () => {
    const dir = makeScratchDir();
    const warnings = spyOnWarnings();
    try {
      const cycles = await runCycles(dir, CYCLE_COUNT);
      expect(cycles).toHaveLength(CYCLE_COUNT);
      for (const cycle of cycles) {
        const { real } = cycle;
        expect(cycle.didRetire).toBe(true);
        expect(cycle.isFdClosedAtClose).toBe(true);
        expect(real.lease.isClosed).toBe(true);
        expect(real.lease.isClosing).toBe(false);
        expect(real.transport.destroyed).toBe(true);
        expect(real.transport.worker.threadId).toBe(-1);
        const messages = readMessages(real.file);
        expect(messages).toEqual(cycle.expected);
      }
      const isEveryFdReleased = cycles.every((cycle): boolean => isFdReleased(cycle.real.lease));
      expect(isEveryFdReleased).toBe(true);
      expect(warnings.warnings).toEqual([]);
    } finally {
      warnings.restore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
