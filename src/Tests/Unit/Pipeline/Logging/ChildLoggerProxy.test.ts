/**
 * Unit tests for `Logging/ChildLoggerProxy.buildDeferredLogger` — Proxy
 * that defers pino child creation until first property access.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import { buildDeferredLogger } from '../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js';
import { getRootLoggerGeneration } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';

/** Upper bound on the property reads one `LOG.info(...)` triggers — pino
 *  reads ~22 of its own internal symbols off `this`, and `this` IS the proxy. */
const READS_PER_LOG_CALL = 30;

/** Portable RUNS_ROOT so Linux CI never creates a `C:\` directory. */
const UPGRADE_TMP_ROOT = os.tmpdir();
const UPGRADE_RUNS_ROOT = path.join(UPGRADE_TMP_ROOT, 'test-runs-proxy-upgrade');

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
 * The observable is the logger's own `level`. `CI` is forced on so
 * `isDevMode` is false, which makes the pre-bank root transportless
 * (`level: 'silent'`) and the post-bank root file-backed (`level: 'info'`).
 * A permanently-memoised child would keep reporting `'silent'`.
 */
describe('Feature — deferred proxy invalidates its child on root upgrade', () => {
  const originalCi = process.env.CI;

  afterEach(() => {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    delete process.env.FORENSIC_TRACE;
    delete process.env.RUNS_ROOT;
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
});
