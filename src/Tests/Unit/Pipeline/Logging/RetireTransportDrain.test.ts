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
import pino from 'pino';

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

/**
 * Build a fake retired stream with an idle `ThreadStream` state record.
 * @returns Probe exposing the candidate, state words, and termination count.
 */
function makeStreamProbe(): IStreamProbe {
  const state = new Int32Array(32);
  const implSymbol = Symbol('kImpl');
  let terminateCalls = 0;
  let closeListener: (() => boolean) | false = false;

  /**
   * Record one `worker.terminate()` call.
   * @returns Resolved worker exit code.
   */
  function terminate(): Promise<number> {
    terminateCalls += 1;
    return Promise.resolve(0);
  }

  /**
   * Report how many times `worker.terminate()` ran.
   * @returns Termination call count.
   */
  function countTerminations(): number {
    return terminateCalls;
  }

  /**
   * Fire the `'close'` listener registered by retirement.
   * @returns True when a listener was registered.
   */
  function emitClose(): boolean {
    if (closeListener === false) return false;
    return closeListener();
  }

  const stream: IPinoStreamCandidate = {
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
    once: (_event, listener): object => {
      closeListener = listener;
      return {};
    },
    worker: { terminate },
  };
  Object.defineProperty(stream, implSymbol, {
    value: { state, ending: false, flushing: false, buf: '' },
  });
  return { stream, state, terminateCalls: countTerminations, emitClose };
}

describe('requestWorkerEnd — graceful end handshake', () => {
  it('reports unsupported when the stream carries no ThreadStream state', () => {
    const outcome: WorkerEndOutcome = requestWorkerEnd({});
    expect(outcome).toBe('unsupported');
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
        { target: 'pino/file', options: { destination: fileLog }, level: 'trace' },
      ],
    });
    try {
      const logger = pino({ level: 'trace' }, transport);
      for (let idx = 0; idx < RECORD_COUNT; idx += 1) logger.info({ msg: `drain-${String(idx)}` });
      const retire = await import('../../../../Scrapers/Pipeline/Logging/RetireTransport.js');
      const stream = candidateOf(transport);
      retire.scheduleStreamClose(stream, CLOSE_WAIT_MS);
      const isClosed = await waitUntil((): boolean => isTransportClosed(transport));
      expect(isClosed).toBe(true);
      const prettyCount = countRecords(prettyLog);
      expect(prettyCount).toBe(RECORD_COUNT);
      const fileCount = countRecords(fileLog);
      expect(fileCount).toBe(RECORD_COUNT);
      const hasTimeout = warnings.some(msg => msg.includes('worker drain timed out'));
      expect(hasTimeout).toBe(false);
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
