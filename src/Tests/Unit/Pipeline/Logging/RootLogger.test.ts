/**
 * Unit tests for `Logging/RootLogger` — lazy pino instantiation and
 * destination-keyed caching.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';
import type pino from 'pino';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import retireSupersededLogger from '../../../../Scrapers/Pipeline/Logging/RetireTransport.js';
import {
  buildPinoOptions,
  buildSilentOptions,
  getRootLogger,
  getRootLoggerGeneration,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { type IPinoStream, loggerWithStream, readPinoStream } from '../../../Helpers/PinoStream.js';

/** Portable RUNS_ROOT so Linux CI never creates a `C:\` directory. */
const UPGRADE_TMP_ROOT = os.tmpdir();
const UPGRADE_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-rootlogger-upgrade');
const SWITCH_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-rootlogger-switch');

const BURST_RECORDS_PER_SWITCH = 20;

interface ISwitchedRun {
  readonly tag: string;
  readonly logFile: string;
  readonly logger: pino.Logger;
  readonly stream: IPinoStream;
  readonly wasOpenBeforeRetire: boolean;
}

interface ITraceHarness {
  readonly getLogFile: () => string;
}

interface IRootHarness {
  readonly getRootLogger: () => pino.Logger;
  readonly retireRunLogger: () => boolean;
}

/** Opens a bank scope and restores the previous async context afterwards. */
type RunWithBankContext = <T>(bank: string, fn: () => T) => T;

/** The loaded modules a sequential run capture drives. */
interface IRunModules {
  readonly runWithBankContext: RunWithBankContext;
  readonly trace: ITraceHarness;
  readonly root: IRootHarness;
}

/**
 * Yield event-loop turns until `predicate()` holds or `deadlineMs` expires.
 * @param predicate - Condition being awaited.
 * @param deadlineMs - Epoch-ms wall-clock deadline (defaults to 5 s from start).
 * @returns True when `predicate()` held before `deadlineMs`, false on timeout.
 */
async function waitUntil(
  predicate: () => boolean,
  deadlineMs: number = Date.now() + 5_000,
): Promise<boolean> {
  if (predicate()) return true;
  if (Date.now() >= deadlineMs) return false;
  await new Promise<true>(resolve => {
    setTimeout(resolve, 10, true);
  });
  return waitUntil(predicate, deadlineMs);
}

/**
 * Run a sequence of alternating banks, each in its own run scope, emitting one
 * tagged record per run and retiring that run's destination at run end.
 * @param modules - Loaded TraceConfig, RootLogger, and bank-context entry point.
 * @param banks - Ordered bank slugs to activate.
 * @returns Captured per-run entries.
 */
function captureAlternatingSwitches(
  modules: IRunModules,
  banks: readonly string[],
): ISwitchedRun[] {
  return banks.map((bank, idx): ISwitchedRun => {
    const tag = `switch-record-${String(idx)}`;
    return modules.runWithBankContext(bank, (): ISwitchedRun => {
      const logFile = modules.trace.getLogFile();
      const logger = modules.root.getRootLogger();
      const stream = readPinoStream(logger);
      const wasOpenBeforeRetire = stream.closed !== true;
      for (let lineIdx = 0; lineIdx < BURST_RECORDS_PER_SWITCH; lineIdx += 1) {
        logger.info({ msg: `${tag}-line-${String(lineIdx)}` });
      }
      modules.root.retireRunLogger();
      return { tag, logFile, logger, stream, wasOpenBeforeRetire };
    });
  });
}

/**
 * Verify every superseded run closed its worker + descriptor and flushed all burst lines.
 * @param superseded - Retired switched-run entries.
 * @returns Always true.
 */
function assertSupersededRunsFlushedAndClosed(superseded: readonly ISwitchedRun[]): true {
  for (const entry of superseded) {
    expect(entry.stream.closed).toBe(true);
    expect(entry.stream.destroyed).toBe(true);
    const content = fs.readFileSync(entry.logFile, 'utf8');
    for (let lineIdx = 0; lineIdx < BURST_RECORDS_PER_SWITCH; lineIdx += 1) {
      expect(content).toContain(`${entry.tag}-line-${String(lineIdx)}`);
    }
  }
  return true;
}

/** Property reads a single `LOG.info(...)` performs — pino reads ~22 of its
 *  own internal symbols off `this`, and every one lands on the child proxy. */
const READS_PER_LOG_CALL = 30;

/**
 * Assert that a retired stream suppresses stale-write errors while surfacing
 * genuine drain/disk errors through `process.emitWarning`.
 * @param retired - Retired switched-run entry.
 * @returns True after verification.
 */
async function assertRetiredStreamErrorRouting(retired: ISwitchedRun): Promise<true> {
  /**
   * Swallow emitted process warnings while spying on `process.emitWarning`.
   * @returns True once recorded.
   */
  const swallowWarning: typeof process.emitWarning = (): true => true;
  const warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(swallowWarning);
  try {
    retired.logger.info({ msg: 'late-unproxied-write' });
    await new Promise<true>(resolve => {
      setImmediate(resolve, true);
    });
    expect(warnSpy).not.toHaveBeenCalled();
    const diskFull = new ScraperError('ENOSPC: disk full');
    retired.stream.emit?.('error', diskFull);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const firstWarning = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(firstWarning).toContain('ENOSPC: disk full');
    return true;
  } finally {
    warnSpy.mockRestore();
  }
}

describe('Feature — getRootLogger', () => {
  it('returns a pino-shaped logger with the level/info/error methods', () => {
    const log = getRootLogger();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('does not throw when emitting through the root logger', () => {
    const log = getRootLogger();
    expect(() => {
      log.info({ msg: 'rootlogger-test' });
    }).not.toThrow();
  });
});

describe('Feature — root logger is cached per destination (worker-leak regression)', () => {
  it('returns the identical instance across repeated calls', () => {
    const first = getRootLogger();
    const second = getRootLogger();
    expect(second).toBe(first);
  });

  it('does not rebuild while the destination is unchanged', () => {
    getRootLogger();
    const before = getRootLoggerGeneration();
    for (let i = 0; i < READS_PER_LOG_CALL; i += 1) getRootLogger();
    const after = getRootLoggerGeneration();
    expect(after).toBe(before);
  });
});

describe('Feature — root logger rebuilds exactly once on destination upgrade', () => {
  const originalForensicTrace = process.env.FORENSIC_TRACE;
  const originalRunsRoot = process.env.RUNS_ROOT;
  const originalPrettyLogs = process.env.PRETTY_LOGS;

  beforeEach(() => {
    delete process.env.PRETTY_LOGS;
  });

  afterEach(() => {
    if (originalForensicTrace === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = originalForensicTrace;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    if (originalPrettyLogs === undefined) delete process.env.PRETTY_LOGS;
    else process.env.PRETTY_LOGS = originalPrettyLogs;
    jest.resetModules();
  });

  it('holds the pre-bank logger, then swaps once when a bank scope opens', async () => {
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = UPGRADE_RUNS_ROOT;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const bankContext = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const preBankFile = trace.getLogFile();
    expect(preBankFile).toBe('');
    const preBank = root.getRootLogger();
    const preBankAgain = root.getRootLogger();
    expect(preBankAgain).toBe(preBank);
    const generationBeforeBank = root.getRootLoggerGeneration();
    const observed = bankContext.runWithBankContext('pepper', () => {
      const postBankFile = trace.getLogFile();
      const postBank = root.getRootLogger();
      const generationAfterBank = root.getRootLoggerGeneration();
      const postBankAgain = root.getRootLogger();
      const generationSettled = root.getRootLoggerGeneration();
      root.retireRunLogger();
      return {
        postBankFile,
        postBank,
        generationAfterBank,
        postBankAgain,
        generationSettled,
      };
    });
    expect(observed.postBankFile.length).toBeGreaterThan(0);
    expect(observed.postBank).not.toBe(preBank);
    expect(observed.generationAfterBank).toBe(generationBeforeBank + 1);
    expect(observed.postBankAgain).toBe(observed.postBank);
    expect(observed.generationSettled).toBe(observed.generationAfterBank);
  });

  it('drains and closes each run’s file-transport worker across repeated alternating banks', async () => {
    fs.rmSync(SWITCH_RUNS_ROOT, { recursive: true, force: true });
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = SWITCH_RUNS_ROOT;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const bankContext = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const preBank = root.getRootLogger();
    const stdoutStream = readPinoStream(preBank);
    const banks = ['pepper', 'hapoalim', 'pepper', 'hapoalim'] as const;
    const modules: IRunModules = {
      runWithBankContext: bankContext.runWithBankContext,
      trace,
      root,
    };
    const runs = captureAlternatingSwitches(modules, banks);
    /**
     * Check whether every run's stream closed and its file holds the last line.
     * @returns True once settled.
     */
    const isSettled = (): boolean => {
      const isEveryClosed = runs.every(entry => entry.stream.closed === true);
      if (!isEveryClosed) return false;
      return runs.every(entry => {
        if (!fs.existsSync(entry.logFile)) return false;
        const text = fs.readFileSync(entry.logFile, 'utf8');
        return text.includes(`${entry.tag}-line-${String(BURST_RECORDS_PER_SWITCH - 1)}`);
      });
    };
    const didSettle = await waitUntil(isSettled);
    expect(didSettle).toBe(true);
    expect(stdoutStream.fd).toBe(1);
    expect(stdoutStream.closed).not.toBe(true);
    const didEveryRunStartOpen = runs.every(entry => entry.wasOpenBeforeRetire);
    expect(didEveryRunStartOpen).toBe(true);
    assertSupersededRunsFlushedAndClosed(runs);
    await assertRetiredStreamErrorRouting(runs[0]);
  });

  it('never invokes blocking end() and keeps the event loop responsive when a retired worker stalls', async () => {
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
    const endSpy = jest.fn<boolean, []>((): boolean => {
      throw new ScraperError('blocking end() must never be called');
    });
    let isTerminated = false;
    const terminateSpy = jest.fn<Promise<number>, []>((): Promise<number> => {
      isTerminated = true;
      return Promise.resolve(1);
    });
    const stalledStream = {
      closed: false,
      destroyed: false,
      end: endSpy,
      /**
       * Simulate a stalled worker whose `flush` callback never resolves.
       * @returns Always true.
       */
      flush: (): boolean => true,
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
      worker: { terminate: terminateSpy },
    };
    try {
      const stalledLogger = loggerWithStream(stalledStream);
      retireSupersededLogger(stalledLogger, false, 40);
      const tickStart = performance.now();
      await new Promise<true>(resolve => {
        setTimeout(resolve, 10, true);
      });
      const tickElapsedMs = performance.now() - tickStart;
      expect(tickElapsedMs).toBeLessThan(250);
      const didTerminate = await waitUntil((): boolean => isTerminated);
      expect(didTerminate).toBe(true);
      expect(endSpy).not.toHaveBeenCalled();
      expect(terminateSpy).toHaveBeenCalledTimes(1);
      const hasTimeoutWarning = warnings.some(msg => msg.includes('worker drain timed out'));
      expect(hasTimeoutWarning).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('Feature — buildPinoOptions silent vs active dispatch (CR #337)', () => {
  it('returns level: "silent" when transport is the disabled sentinel (false)', () => {
    const opts = buildPinoOptions(false);
    expect(opts.level).toBe('silent');
    expect('transport' in opts).toBe(false);
  });

  it('returns env-driven level + transport pass-through when transport is real', () => {
    const fakeTransport = { target: 'pino/file', options: { destination: 1 } };
    const opts = buildPinoOptions(fakeTransport);
    expect(opts.transport).toBe(fakeTransport);
    expect(opts.level).toBe(process.env.LOG_LEVEL ?? 'info');
  });

  it('buildSilentOptions never omits redact / mixin', () => {
    const opts = buildSilentOptions();
    expect(opts.redact).toBeDefined();
    expect(typeof opts.mixin).toBe('function');
  });

  it('buildPinoOptions carries the transport reference unchanged', () => {
    const fakeTransport = { target: 'pino-pretty', options: { colorize: true } };
    const opts = buildPinoOptions(fakeTransport);
    expect(opts.transport).toBe(fakeTransport);
  });
});
