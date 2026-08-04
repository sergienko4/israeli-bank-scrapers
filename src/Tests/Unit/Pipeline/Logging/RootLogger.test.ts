/**
 * Unit tests for `Logging/RootLogger` — lazy pino instantiation and
 * destination-keyed caching.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import {
  buildActiveOptions,
  buildPinoOptions,
  buildSilentOptions,
  getRootLogger,
  getRootLoggerGeneration,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';

/** Portable RUNS_ROOT so Linux CI never creates a `C:\` directory. */
const UPGRADE_TMP_ROOT = os.tmpdir();
const UPGRADE_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-rootlogger-upgrade');

/** Property reads a single `LOG.info(...)` performs — pino reads ~22 of its
 *  own internal symbols off `this`, and every one lands on the child proxy. */
const READS_PER_LOG_CALL = 30;

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
