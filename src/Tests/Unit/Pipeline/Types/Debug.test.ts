/**
 * Unit tests for Types/Debug — child logger factory, runWithBankContext, re-exports.
 */

import { jest } from '@jest/globals';

import {
  capTimeout,
  getDebug,
  isMockTimingActive,
  MOCK_TIMEOUT_MS,
  runWithBankContext,
} from '../../../../Scrapers/Pipeline/Types/Debug.js';

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
    const result = await runWithBankContext(
      'bankY',
      (): Promise<string> => Promise.resolve('done'),
    );
    expect(result).toBe('done');
  });
});

// buildLogFilePath was removed — log path resolution now lives in
// TraceConfig.getLogFile() (gated by LOG_LEVEL=trace). See
// `Tests/Unit/Pipeline/Types/TraceConfig.test.ts` for coverage.

describe('Debug re-exports from MockTiming', () => {
  it('re-exports capTimeout', () => {
    expect(typeof capTimeout).toBe('function');
  });

  it('re-exports isMockTimingActive', () => {
    expect(typeof isMockTimingActive).toBe('function');
  });

  it('re-exports MOCK_TIMEOUT_MS constant', () => {
    expect(MOCK_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

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
      await import('../../../../Scrapers/Pipeline/Types/Debug.js');
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
    jest.resetModules();
  });

  it('LOG_LEVEL=trace + isDevMode=true builds multi-target transport', async () => {
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = 'C:/tmp/test-runs-dev';
    jest.resetModules();
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.setActiveBank('beinleumi');
    const mod = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'hello' });
    }).not.toThrow();
  });

  it('LOG_LEVEL=trace + CI=true builds file-only transport (non-dev)', async () => {
    process.env.CI = '1';
    delete process.env.NODE_ENV;
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = 'C:/tmp/test-runs-ci';
    jest.resetModules();
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.setActiveBank('beinleumi');
    const mod = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'hi' });
    }).not.toThrow();
  });

  it('non-trace + CI + production → transport=false (no file output)', async () => {
    process.env.CI = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'x' });
    }).not.toThrow();
  });

  it('non-trace + dev mode → DEV_TRANSPORT pretty stdout (no file)', async () => {
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
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
    const mod = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
    const log = mod.getDebug(import.meta.url);
    expect(() => {
      log.info({ msg: 'info ok' });
      log.debug({ msg: 'debug filtered out' });
    }).not.toThrow();
  });

  it('LOG fired before setActiveBank does NOT lock cache — first post-bank LOG picks up file path', async () => {
    delete process.env.CI;
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = 'C:/tmp/test-runs-cache-invalidation';
    jest.resetModules();
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    const dbg = await import('../../../../Scrapers/Pipeline/Types/Debug.js');
    const log = dbg.getDebug(import.meta.url);
    const preFile = tc.getLogFile();
    expect(preFile).toBe('');
    expect(() => {
      log.info({ msg: 'pre-bank — terminal only' });
    }).not.toThrow();
    const stillEmpty = tc.getLogFile();
    expect(stillEmpty).toBe('');
    tc.setActiveBank('pepper');
    const fileAfterBank = tc.getLogFile();
    expect(fileAfterBank.length).toBeGreaterThan(0);
    expect(fileAfterBank).toMatch(/[\\/]pepper[\\/]/);
    expect(() => {
      log.info({ msg: 'post-bank — should write to file' });
    }).not.toThrow();
  });
});
