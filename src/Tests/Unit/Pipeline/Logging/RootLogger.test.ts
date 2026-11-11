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
import {
  buildActiveOptions,
  buildPinoOptions,
  buildSilentOptions,
  getRootLogger,
  getRootLoggerGeneration,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';

/**
 * Read Pino's internal `Symbol(pino.stream)` property off `logger` across
 * `jest.resetModules()` boundaries (where each VM realm creates its own Symbol).
 * @param logger - Pino logger instance.
 * @returns Underlying transport stream object.
 */
function readPinoStream(logger: object): {
  fd?: number;
  closed?: boolean;
  destroyed?: boolean;
  emit?: (event: 'error', err: Error) => boolean;
} {
  const sym = Object.getOwnPropertySymbols(logger).find(
    (candidate): boolean => candidate.description === 'pino.stream',
  );
  if (!sym) return {};
  return Reflect.get(logger, sym) as {
    fd?: number;
    closed?: boolean;
    destroyed?: boolean;
    emit?: (event: 'error', err: Error) => boolean;
  };
}
/** Portable RUNS_ROOT so Linux CI never creates a `C:\` directory. */
const UPGRADE_TMP_ROOT = os.tmpdir();
const UPGRADE_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-rootlogger-upgrade');
const SWITCH_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-rootlogger-switch');

interface ISwitchedRun {
  readonly tag: string;
  readonly logFile: string;
  readonly logger: pino.Logger;
  readonly stream: {
    closed?: boolean;
    destroyed?: boolean;
    emit?: (event: 'error', err: Error) => boolean;
  };
}

interface ITraceHarness {
  readonly setActiveBank: (slug: string) => boolean;
  readonly getLogFile: () => string;
}

interface IRootHarness {
  readonly getRootLogger: () => pino.Logger;
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
 * Run a sequence of alternating bank switches, emitting one tagged record per
 * switch and capturing the destination, logger, and underlying Pino stream.
 * @param trace - Loaded TraceConfig module.
 * @param root - Loaded RootLogger module.
 * @param banks - Ordered bank slugs to activate.
 * @returns Captured per-switch run entries.
 */
function captureAlternatingSwitches(
  trace: ITraceHarness,
  root: IRootHarness,
  banks: readonly string[],
): ISwitchedRun[] {
  return banks.map((bank, idx): ISwitchedRun => {
    const tag = `switch-record-${String(idx)}`;
    trace.setActiveBank(bank);
    const logFile = trace.getLogFile();
    const logger = root.getRootLogger();
    logger.info({ msg: tag });
    const stream = readPinoStream(logger);
    return { tag, logFile, logger, stream };
  });
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
function assertRetiredStreamErrorRouting(retired: ISwitchedRun): true {
  /**
   * Swallow emitted process warnings while spying on `process.emitWarning`.
   * @returns True once recorded.
   */
  const swallowWarning: typeof process.emitWarning = (): true => true;
  const warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(swallowWarning);
  try {
    retired.logger.info({ msg: 'late-unproxied-write' });
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

  afterEach(() => {
    if (originalForensicTrace === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = originalForensicTrace;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    jest.resetModules();
  });

  it('holds the pre-bank logger, then swaps once when setActiveBank lands', async () => {
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = UPGRADE_RUNS_ROOT;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    trace.resetTraceConfigCache();
    const preBankFile = trace.getLogFile();
    expect(preBankFile).toBe('');
    const preBank = root.getRootLogger();
    const preBankAgain = root.getRootLogger();
    expect(preBankAgain).toBe(preBank);
    const generationBeforeBank = root.getRootLoggerGeneration();
    trace.setActiveBank('pepper');
    const postBankFile = trace.getLogFile();
    expect(postBankFile.length).toBeGreaterThan(0);
    const postBank = root.getRootLogger();
    expect(postBank).not.toBe(preBank);
    const generationAfterBank = root.getRootLoggerGeneration();
    expect(generationAfterBank).toBe(generationBeforeBank + 1);
    const postBankAgain = root.getRootLogger();
    expect(postBankAgain).toBe(postBank);
    const generationSettled = root.getRootLoggerGeneration();
    expect(generationSettled).toBe(generationAfterBank);
  });

  it('drains and closes superseded file-transport workers across repeated alternating bank switches', async () => {
    fs.rmSync(SWITCH_RUNS_ROOT, { recursive: true, force: true });
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = SWITCH_RUNS_ROOT;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    trace.resetTraceConfigCache();
    const preBank = root.getRootLogger();
    const stdoutStream = readPinoStream(preBank);
    const banks = ['pepper', 'hapoalim', 'pepper', 'hapoalim'] as const;
    const runs = captureAlternatingSwitches(trace, root, banks);
    const superseded = runs.slice(0, 3);
    const active = runs[3];
    /**
     * Check whether all superseded streams closed and the active file flushed.
     * @returns True once settled.
     */
    const isSettled = (): boolean => {
      const isEveryClosed = superseded.every(entry => entry.stream.closed === true);
      if (!isEveryClosed || !fs.existsSync(active.logFile)) return false;
      const activeText = fs.readFileSync(active.logFile, 'utf8');
      return activeText.includes(active.tag);
    };
    active.logger.flush();
    const didSettle = await waitUntil(isSettled);
    expect(didSettle).toBe(true);
    expect(stdoutStream.fd).toBe(1);
    expect(stdoutStream.closed).not.toBe(true);
    for (const entry of superseded) {
      expect(entry.stream.closed).toBe(true);
      expect(entry.stream.destroyed).toBe(true);
      const content = fs.readFileSync(entry.logFile, 'utf8');
      expect(content).toContain(entry.tag);
    }
    expect(active.stream.closed).not.toBe(true);
    assertRetiredStreamErrorRouting(superseded[0]);
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

  it('buildActiveOptions carries the transport reference unchanged', () => {
    const fakeTransport = { target: 'pino-pretty', options: { colorize: true } };
    const opts = buildActiveOptions(fakeTransport);
    expect(opts.transport).toBe(fakeTransport);
  });
});
