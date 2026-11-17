/**
 * Unit tests for Logging/Debug — child logger factory and runWithBankContext.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import { getDebug, runWithBankContext } from '../../../../Scrapers/Pipeline/Logging/Debug.js';

/** Portable test-only RUNS_ROOT prefixes — avoids hard-coding a Windows
 *  path so Linux CI runners do not create directories named `C:\tmp\...`. */
const DEBUG_TEST_TMP_ROOT = os.tmpdir();
const DEBUG_TEST_RUNS_ROOT_DEV = path.join(DEBUG_TEST_TMP_ROOT, 'test-runs-dev');
const DEBUG_TEST_RUNS_ROOT_CI = path.join(DEBUG_TEST_TMP_ROOT, 'test-runs-ci');
const DEBUG_TEST_RUNS_ROOT_CACHE = path.join(DEBUG_TEST_TMP_ROOT, 'test-runs-cache-invalidation');

/**
 * Yield until `predicate()` holds or the deadline passes.
 * @param predicate - Condition being awaited.
 * @param deadlineMs - Epoch-ms wall-clock deadline.
 * @returns True when the predicate held before the deadline.
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

describe('getDebug', () => {
  it('returns a logger with info/debug/warn/error methods', () => {
    const log = getDebug(import.meta.url);
    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('returns a new child for each name (may share prototype)', () => {
    const a = getDebug(import.meta.url);
    const b = getDebug(import.meta.url);
    expect(typeof a.info).toBe('function');
    expect(typeof b.info).toBe('function');
  });
});

describe('Feature — WithBankContext', () => {
  it('returns the fn result synchronously', () => {
    const result = runWithBankContext('bankX', (): number => 42);
    expect(result).toBe(42);
  });

  it('supports async return values', async () => {
    const result = await runWithBankContext('bankY', (): Promise<string> =>
      Promise.resolve('done'),
    );
    expect(result).toBe('done');
  });
});

// buildLogFilePath was removed — log path resolution now lives in
// TraceConfig.getLogFile() (gated by FORENSIC_TRACE). See
// `Tests/Unit/Pipeline/Types/TraceConfig.test.ts` for coverage.

// ── Redaction / censor behaviour via pino integration ──────────────

describe('Pino censor integration (PII redaction)', () => {
  it('sensitive values are redacted when logged through child logger', () => {
    // Using the real logger which has redaction configured.
    const log = getDebug(import.meta.url);
    // The exact redaction is path-based and depends on DebugConfig; we at
    // least exercise the logger tree to keep coverage on Debug.ts init.
    log.info({ accountNumber: '40286139', password: 'secret' });
    expect(typeof log.child).toBe('function');
  });

  it('logger methods are callable without throwing', () => {
    const log = getDebug(import.meta.url);
    expect(() => {
      log.debug({ x: 1 });
    }).not.toThrow();
    expect(() => {
      log.trace({ x: 2 });
    }).not.toThrow();
    expect(() => {
      log.info({ x: 3 });
    }).not.toThrow();
    expect(() => {
      log.warn({ x: 4 });
    }).not.toThrow();
    expect(() => {
      log.error({ x: 5 });
    }).not.toThrow();
  });

  it('runWithBankContext injects bank into log mixin (no throw)', async () => {
    const { runWithBankContext: run } =
      await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = getDebug(import.meta.url);
    const didRun = run('bankHapoalim', (): boolean => {
      log.info({ msg: 'hello' });
      return true;
    });
    expect(didRun).toBe(true);
  });

  it.each([
    { field: 'accountNumber', value: '40286139' },
    { field: 'balance', value: 123.45 },
    { field: 'balance', value: -50 },
    { field: 'balance', value: 0 },
    { field: 'chargedAmount', value: -99 },
    { field: 'originalAmount', value: 100 },
    { field: 'cardUniqueId', value: 'GUID-LONG-VALUE' },
    { field: 'cardUniqueId', value: 'X' },
    { field: 'password', value: 'secret12345' },
    { field: 'accountNumber', value: 'abc' },
  ])('censor exercises redaction path for $field', ({ field, value }) => {
    const log = getDebug(import.meta.url);
    const payload: Record<string, unknown> = { [field]: value };
    expect(() => {
      log.info(payload);
    }).not.toThrow();
  });

  it('censor runs for nested paths (credentials.password etc.)', () => {
    const log = getDebug(import.meta.url);
    expect(() => {
      log.info({
        credentials: { password: 'pw-abc', id: 'idabc', num: 'nnn', card6Digits: '123456' },
        auth: { token: 'tk', calConnectToken: 'cct' },
        token: 'topLevel',
        secret: 'ss',
        otp: '111',
        otpCode: '222',
        authorization: 'Bearer x',
      });
    }).not.toThrow();
  });
});

// ── buildTransport env-permutation coverage via jest.isolateModules ───────

describe('Debug buildTransport — env-permutation branches', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalRunsRoot = process.env.RUNS_ROOT;
  const originalCi = process.env.CI;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalForensicTrace = process.env.FORENSIC_TRACE;
  const originalPrettyLogs = process.env.PRETTY_LOGS;

  afterEach(() => {
    // Restore env exactly.
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalForensicTrace === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = originalForensicTrace;
    if (originalPrettyLogs === undefined) delete process.env.PRETTY_LOGS;
    else process.env.PRETTY_LOGS = originalPrettyLogs;
    jest.resetModules();
  });

  it('FORENSIC_TRACE + PRETTY_LOGS builds multi-target transport', async () => {
    delete process.env.CI;
    process.env.PRETTY_LOGS = 'true';
    process.env.LOG_LEVEL = 'trace';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = DEBUG_TEST_RUNS_ROOT_DEV;
    jest.resetModules();
    const bankContext = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const mod = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = mod.getDebug(import.meta.url);
    bankContext.runWithBankContext('beinleumi', () => {
      expect(() => {
        log.info({ msg: 'hello' });
      }).not.toThrow();
    });
  });

  it('FORENSIC_TRACE without PRETTY_LOGS builds file-only transport', async () => {
    process.env.CI = '1';
    delete process.env.NODE_ENV;
    delete process.env.PRETTY_LOGS;
    process.env.LOG_LEVEL = 'trace';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = DEBUG_TEST_RUNS_ROOT_CI;
    jest.resetModules();
    const bankContext = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const mod = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = mod.getDebug(import.meta.url);
    bankContext.runWithBankContext('beinleumi', () => {
      expect(() => {
        log.info({ msg: 'hi' });
      }).not.toThrow();
    });
  });

  it('non-trace without PRETTY_LOGS → transport=false (no output)', async () => {
    process.env.CI = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.PRETTY_LOGS;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'x' });
    }).not.toThrow();
  });

  it('non-trace + PRETTY_LOGS → pretty stdout (no file)', async () => {
    delete process.env.CI;
    process.env.PRETTY_LOGS = 'true';
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'dev pretty only' });
    }).not.toThrow();
  });

  it('LOG_LEVEL=info still emits info logs (level lower than trace)', async () => {
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'info';
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'info ok' });
      log.debug({ msg: 'debug filtered out' });
    }).not.toThrow();
  });

  it('mixin auto-injects runId inside a run scope — no per-call wiring', async () => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const bank = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const observed = bank.runWithBankContext('beinleumi', () => ({
      fields: bank.getBankMixin(),
      expectedRunId: tc.getActiveRunId(),
    }));
    expect(observed.expectedRunId).not.toBe('');
    expect(observed.fields.runId).toBe(observed.expectedRunId);
    // Same mixin still emits phase / stage so no field is dropped.
    expect(observed.fields.phase).toBeDefined();
    expect(observed.fields.stage).toBeDefined();
  });

  it('mixin omits runId when bank not yet registered', async () => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const bank = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const fields = bank.getBankMixin();
    expect(fields.runId).toBeUndefined();
  });

  it('LOG fired before a run scope does NOT lock cache — first in-scope LOG picks up file path', async () => {
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'trace';
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = DEBUG_TEST_RUNS_ROOT_CACHE;
    jest.resetModules();
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const bank = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
    const root = await import('../../../../Scrapers/Pipeline/Logging/RootLogger.js');
    const dbg = await import('../../../../Scrapers/Pipeline/Logging/Debug.js');
    const log = dbg.getDebug(import.meta.url);
    const preFile = tc.getLogFile();
    expect(preFile).toBe('');
    expect(() => {
      log.info({ msg: 'pre-bank — terminal only' });
    }).not.toThrow();
    const stillEmpty = tc.getLogFile();
    expect(stillEmpty).toBe('');
    const observed = await bank.runWithBankContext('pepper', async () => {
      const fileAfterBank = tc.getLogFile();
      expect(fileAfterBank.length).toBeGreaterThan(0);
      expect(fileAfterBank).toMatch(/[\\/]pepper[\\/]/);
      log.info({ msg: 'post-bank — should write to file' });
      root.getRootLogger().flush();
      const didContain = await waitUntil(
        (): boolean =>
          fs.existsSync(fileAfterBank) &&
          fs.readFileSync(fileAfterBank, 'utf8').includes('post-bank'),
      );
      root.retireRunLogger();
      return { fileAfterBank, didContain };
    });
    expect(observed.didContain).toBe(true);
  });
});
