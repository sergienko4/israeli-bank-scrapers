/**
 * Unit tests for `Logging/ChildLoggerProxy.buildDeferredLogger` — Proxy
 * that defers pino child creation until first property access.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';
import type pino from 'pino';

import { buildDeferredLogger } from '../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js';
import { getRootLoggerGeneration } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';

/** Upper bound on the property reads one `LOG.info(...)` triggers — pino
 *  reads ~22 of its own internal symbols off `this`, and `this` IS the proxy. */
const READS_PER_LOG_CALL = 30;

/** Portable RUNS_ROOT so Linux CI never creates a `C:\` directory. */
const UPGRADE_TMP_ROOT = os.tmpdir();
const UPGRADE_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-proxy-upgrade');
const SUBCHILD_SWITCH_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-proxy-subchild-switch');

/**
 * Yield until `predicate()` holds or `deadlineMs` expires.
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

/** Prototype-carrying class used to verify custom serializers receive real instances. */
class LabeledItem {
  private readonly _label: string;

  /**
   * Construct a labeled item instance.
   * @param label - Item label.
   */
  constructor(label: string) {
    this._label = label;
  }

  /**
   * Prototype method requiring an uncloned `LabeledItem` prototype chain.
   * @returns Formatted label string.
   */
  public describe(): string {
    return `proto:${this._label}`;
  }
}

/**
 * Create a child sub-logger with prototype-sensitive + `Buffer` serializers,
 * then mutate the caller's object afterwards to prove chindings were serialized.
 * @param log - Deferred module logger.
 * @returns Derived sub-logger.
 */
function createMutatedChild(log: pino.Logger): pino.Logger {
  const initialBindings = {
    correlationId: 'corr-m',
    meta: { stageTag: 'orig-init' },
    labeledItem: new LabeledItem('t1'),
    rawBuf: Buffer.from('ab'),
  };
  const sub = log.child(initialBindings, {
    serializers: {
      /**
       * Serialize `LabeledItem` via its prototype method.
       * @param val - Candidate item instance.
       * @returns Prototype description when preserved.
       */
      labeledItem: (val: LabeledItem): string => val.describe(),
      /**
       * Serialize `Buffer` only when `Buffer.isBuffer` holds.
       * @param val - Candidate buffer value.
       * @returns Hex tag proving `Buffer` identity was preserved.
       */
      rawBuf: (val: Buffer): string => {
        const isBuf = Buffer.isBuffer(val);
        return `isBuf:${String(isBuf)}:${val.toString('hex')}`;
      },
      /**
       * Serialize function-valued binding so non-cloneable payloads are accepted.
       * @param fn - Function value.
       * @returns Marker string.
       */
      nonCloneableFn: (fn: () => string): string => fn(),
    },
  });
  initialBindings.correlationId = 'mutated-init';
  initialBindings.meta.stageTag = 'mutated-stage';
  return sub;
}

/**
 * Exercise level validation and non-cloneable `setBindings()` caller-side mutation on `sub`.
 * @param sub - Derived sub-logger.
 * @returns True after priming.
 */
function applyMutatedBindingsAndLevel(sub: pino.Logger): true {
  sub.level = 'debug';
  expect(() => {
    sub.level = 'not-a-valid-pino-level';
  }).toThrow();
  const nested = { tag: 'orig-upd' };
  /**
   * Non-cloneable callback passed alongside nested mutable state.
   * @returns Serializer output string.
   */
  const nonCloneableFn = (): string => 'fn-serialized';
  const updateBindings: pino.Bindings = { beforeSwitch: 'yes', nested, nonCloneableFn };
  Reflect.set(updateBindings, 'correlationId', undefined);
  sub.setBindings(updateBindings);
  updateBindings.beforeSwitch = 'mutated-before';
  nested.tag = 'mutated-upd';
  return true;
}

interface IRootFlushHarness {
  readonly getRootLogger: () => pino.Logger;
}

/**
 * Read Pino's internal `Symbol(pino.stream)` property off `logger` across
 * `jest.resetModules()` boundaries.
 * @param logger - Pino logger instance.
 * @returns Underlying transport stream object.
 */
function readPinoStream(logger: object): { closed?: boolean } {
  const sym = Object.getOwnPropertySymbols(logger).find(
    (candidate): boolean => candidate.description === 'pino.stream',
  );
  if (!sym) return {};
  return Reflect.get(logger, sym) as { closed?: boolean };
}

/**
 * Flush the active root logger, wait until `logFile` contains `needle`, and return its text.
 * @param root - Loaded RootLogger module.
 * @param logFile - Target log file path.
 * @param needle - Substring expected in the flushed log file.
 * @returns Full UTF-8 contents of `logFile`.
 */
async function flushAndReadLogOnceContains(
  root: IRootFlushHarness,
  logFile: string,
  needle: string,
): Promise<string> {
  const activeRoot = root.getRootLogger();
  activeRoot.flush();
  const didFlush = await waitUntil((): boolean => {
    if (!fs.existsSync(logFile)) return false;
    const text = fs.readFileSync(logFile, 'utf8');
    return text.includes(needle);
  });
  expect(didFlush).toBe(true);
  return fs.readFileSync(logFile, 'utf8');
}

describe('Feature — buildDeferredLogger', () => {
  it('returns a Proxy that exposes pino logger methods on access', () => {
    const log = buildDeferredLogger('proxy-test-a');
    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.trace).toBe('function');
  });

  it('forwards .info() to the real pino child without throwing', () => {
    const log = buildDeferredLogger('proxy-test-b');
    expect(() => {
      log.info({ msg: 'hello from deferred proxy' });
    }).not.toThrow();
  });

  it('exposes a callable child() method that returns a sub-logger', () => {
    const log = buildDeferredLogger('proxy-test-c');
    const sub = log.child({ k: 'v' });
    expect(typeof sub.info).toBe('function');
    expect(() => {
      sub.info({ msg: 'sub' });
    }).not.toThrow();
  });

  it('builds independent proxies for distinct names', () => {
    const a = buildDeferredLogger('proxy-test-d1');
    const b = buildDeferredLogger('proxy-test-d2');
    expect(a).not.toBe(b);
    expect(typeof a.info).toBe('function');
    expect(typeof b.info).toBe('function');
  });

  it('survives multiple property reads on the same proxy', () => {
    const log = buildDeferredLogger('proxy-test-e');
    expect(typeof log.info).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(() => {
      log.info({ msg: 'first' });
      log.info({ msg: 'second' });
    }).not.toThrow();
  });
});

describe('Feature — deferred proxy resolves its child once (worker-leak regression)', () => {
  it('does not rebuild the root across many property reads', () => {
    const log = buildDeferredLogger('proxy-leak-a');
    log.info({ msg: 'prime the cache' });
    const before = getRootLoggerGeneration();
    for (let i = 0; i < READS_PER_LOG_CALL; i += 1) {
      const kind = typeof log.info;
      expect(kind).toBe('function');
    }
    const after = getRootLoggerGeneration();
    expect(after).toBe(before);
  });

  it('does not rebuild the root across repeated emits', () => {
    const log = buildDeferredLogger('proxy-leak-b');
    log.info({ msg: 'prime the cache' });
    const before = getRootLoggerGeneration();
    for (let i = 0; i < READS_PER_LOG_CALL; i += 1) log.info({ i }, 'emit');
    const after = getRootLoggerGeneration();
    expect(after).toBe(before);
  });

  it('shares one root across independently built proxies', () => {
    const first = buildDeferredLogger('proxy-leak-c1');
    first.info({ msg: 'prime the cache' });
    const before = getRootLoggerGeneration();
    const second = buildDeferredLogger('proxy-leak-c2');
    second.info({ msg: 'second proxy' });
    const after = getRootLoggerGeneration();
    expect(after).toBe(before);
  });
});

/**
 * Memoising the child is only safe if it is ALSO invalidated. These cases pin
 * the other half of the contract: a proxy that resolved a child against the
 * pre-`setActiveBank` root must pick up the upgraded root on its next access.
 *
 * The observable is the logger's own `level`. Without the `PRETTY_LOGS`
 * opt-in the pre-bank root is transportless (`level: 'silent'`) and the
 * post-bank root file-backed (`level: 'info'`).
 * A permanently-memoised child would keep reporting `'silent'`.
 */
describe('Feature — deferred proxy invalidates its child on root upgrade', () => {
  const originalCi = process.env.CI;
  const originalForensicTrace = process.env.FORENSIC_TRACE;
  const originalRunsRoot = process.env.RUNS_ROOT;
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalPrettyLogs = process.env.PRETTY_LOGS;

  beforeEach(() => {
    delete process.env.PRETTY_LOGS;
  });

  afterEach(() => {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    if (originalForensicTrace === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = originalForensicTrace;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalPrettyLogs === undefined) delete process.env.PRETTY_LOGS;
    else process.env.PRETTY_LOGS = originalPrettyLogs;
    jest.resetModules();
  });

  it('re-resolves the child when setActiveBank upgrades the destination', async () => {
    process.env.CI = 'true';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = UPGRADE_RUNS_ROOT;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const proxy = await import('../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js');
    trace.resetTraceConfigCache();
    const log = proxy.buildDeferredLogger('proxy-upgrade');
    const preBankLevel = log.level;
    expect(preBankLevel).toBe('silent');
    trace.setActiveBank('pepper');
    const postBankLevel = log.level;
    expect(postBankLevel).toBe('info');
  });

  it('re-resolves retained .child() sub-loggers across bank switches after prior transports close', async () => {
    fs.rmSync(SUBCHILD_SWITCH_ROOT, { recursive: true, force: true });
    process.env.CI = 'true';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = SUBCHILD_SWITCH_ROOT;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const proxy = await import('../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js');
    trace.resetTraceConfigCache();
    const log = proxy.buildDeferredLogger('proxy-sub');
    const sub = log.child({ correlationId: 'corr-1' });
    const nested = sub.child({ step: 'step-1' });
    expect(nested.level).toBe('silent');
    trace.setActiveBank('pepper');
    sub.info({ msg: 'pepper-line' });
    const pepperRoot = root.getRootLogger();
    const pepperStream = readPinoStream(pepperRoot);
    trace.setActiveBank('hapoalim');
    const hapoalimLogFile = trace.getLogFile();
    expect(log.level).toBe('info');
    const isClosed = await waitUntil((): boolean => pepperStream.closed === true);
    expect(isClosed).toBe(true);
    expect(pepperStream.closed).toBe(true);
    nested.info({ msg: 'hapoalim-after-pepper-closed' });
    const hapoalimContent = await flushAndReadLogOnceContains(
      root,
      hapoalimLogFile,
      'hapoalim-after-pepper-closed',
    );
    expect(hapoalimContent).toContain('hapoalim-after-pepper-closed');
    expect(hapoalimContent).toContain('"module":"proxy-sub"');
    expect(hapoalimContent).toContain('"correlationId":"corr-1"');
    expect(hapoalimContent).toContain('"step":"step-1"');
  });

  it('preserves mutable level overrides and setBindings() across bank switches', async () => {
    fs.rmSync(SUBCHILD_SWITCH_ROOT, { recursive: true, force: true });
    process.env.CI = 'true';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = SUBCHILD_SWITCH_ROOT;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const proxy = await import('../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js');
    trace.resetTraceConfigCache();
    const log = proxy.buildDeferredLogger('proxy-mutable');
    const sub = createMutatedChild(log);
    trace.setActiveBank('pepper');
    applyMutatedBindingsAndLevel(sub);
    expect(sub.level).toBe('debug');
    trace.setActiveBank('hapoalim');
    const hapoalimLogFile = trace.getLogFile();
    expect(sub.level).toBe('debug');
    sub.setBindings({ afterSwitch: 'also-yes' });
    sub.debug({ msg: 'debug-with-replayed-bindings' });
    const content = await flushAndReadLogOnceContains(
      root,
      hapoalimLogFile,
      'debug-with-replayed-bindings',
    );
    expect(content).toContain('"beforeSwitch":"yes"');
    expect(content).toContain('"tag":"orig-upd"');
    expect(content).toContain('"stageTag":"orig-init"');
    expect(content).toContain('"labeledItem":"proto:t1"');
    expect(content).toContain('"rawBuf":"isBuf:true:6162"');
    expect(content).toContain('"nonCloneableFn":"fn-serialized"');
    expect(content).toContain('"afterSwitch":"also-yes"');
    expect(content).toContain('"correlationId":"corr-m"');
  });

  it('reconstructs sub-loggers with formatters.bindings requiring initial fields across bank switches', async () => {
    fs.rmSync(SUBCHILD_SWITCH_ROOT, { recursive: true, force: true });
    process.env.CI = 'true';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = SUBCHILD_SWITCH_ROOT;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const trace = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const proxy = await import('../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js');
    trace.resetTraceConfigCache();
    const log = proxy.buildDeferredLogger('proxy-fmt');
    trace.setActiveBank('pepper');
    const sub = log.child(
      { tenant: 'bank-a' },
      {
        formatters: {
          /**
           * Formatter that throws if invoked without a string `tenant` field.
           * @param bindings - Incoming bindings object.
           * @returns Uppercased tenant binding.
           */
          bindings: (bindings: pino.Bindings): pino.Bindings => ({
            ...bindings,
            tenant: (bindings.tenant as string).toUpperCase(),
          }),
        },
      },
    );
    const nestedPlain = sub.child({ step: 'nested-plain' });
    const nestedFormatted = sub.child(
      { tenant: 'bank-nested' },
      {
        formatters: {
          /**
           * Nested tenant-requiring formatter verifying deep child reconstruction.
           * @param bindings - Incoming bindings object.
           * @returns Uppercased tenant binding.
           */
          bindings: (bindings: pino.Bindings): pino.Bindings => ({
            ...bindings,
            tenant: (bindings.tenant as string).toUpperCase(),
          }),
        },
      },
    );
    trace.setActiveBank('hapoalim');
    const hapoalimLogFile = trace.getLogFile();
    sub.info({ msg: 'after-switch-formatted' });
    nestedPlain.info({ msg: 'nested-plain-after-switch' });
    nestedFormatted.info({ msg: 'nested-formatted-after-switch' });
    sub.setBindings({ tenant: 'bank-b' });
    sub.info({ msg: 'after-setbindings-formatted' });
    const content = await flushAndReadLogOnceContains(
      root,
      hapoalimLogFile,
      'after-setbindings-formatted',
    );
    expect(content).toContain('"tenant":"BANK-A"');
    expect(content).toContain('"step":"nested-plain"');
    expect(content).toContain('"tenant":"BANK-NESTED"');
    expect(content).toContain('"tenant":"BANK-B"');
  });
});
