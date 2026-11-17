/**
 * Unit tests for TraceConfig — per-execution artefact folder driven by
 * FORENSIC_TRACE=true and the run scope's bank. Covers the off-forensic
 * empty-string contract, lazy creation, and per-scope isolation of the run
 * folder and runId.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import type * as BankContextModuleType from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import type * as EnvironmentModuleType from '../../../../Scrapers/Pipeline/Types/Environment.js';
import type * as TraceConfigModuleType from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import detectBankFromArgv from '../../../Helpers/DetectBankFromArgv.js';

type TraceConfigModule = typeof TraceConfigModuleType;
type EnvironmentModule = typeof EnvironmentModuleType;
type BankContextModule = typeof BankContextModuleType;

/** The module graph one test loads after `jest.resetModules()`. */
interface ITraceRuntime {
  readonly mod: TraceConfigModule;
  readonly runWithBankContext: BankContextModule['runWithBankContext'];
  readonly readEnvironment: EnvironmentModule['readEnvironment'];
}

const TEMP_BASE = os.tmpdir();
const MODULE_PATH = '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

/** Format of the per-run identifier — `DD-MM-YYYY_HHMMSScc`. */
const RUN_ID_FORMAT_RE = /^\d{2}-\d{2}-\d{4}_\d{8}$/;

/**
 * Load a fresh TraceConfig and its run-scope helpers from one module registry.
 * @returns The typed module exports.
 */
async function loadTraceRuntime(): Promise<ITraceRuntime> {
  jest.resetModules();
  const mod = (await import(MODULE_PATH)) as TraceConfigModule;
  const environment = await import('../../../../Scrapers/Pipeline/Types/Environment.js');
  const bankContext = await import('../../../../Scrapers/Pipeline/Logging/BankContext.js');
  return {
    mod,
    runWithBankContext: bankContext.runWithBankContext,
    readEnvironment: environment.readEnvironment,
  };
}

/**
 * Resolve the run folder through the exported log path.
 * @param mod - Loaded TraceConfig module.
 * @returns Run folder, or '' off-trace.
 */
function runFolderOf(mod: TraceConfigModule): string {
  const logFile = mod.getLogFile();
  return logFile.length > 0 ? path.dirname(logFile) : '';
}

/**
 * Build a unique tmp directory path under TEMP_BASE for a single test.
 * @param prefix - Folder-name prefix.
 * @returns Absolute path to the tmp directory (not yet created).
 */
function makeTmpRoot(prefix: string): string {
  const millis = Date.now();
  const stamp = String(millis);
  return path.join(TEMP_BASE, `${prefix}-${stamp}`);
}

/**
 * Probe a single FORENSIC_TRACE value against the log-path gate.
 * @param value - Value to set for `FORENSIC_TRACE`.
 * @returns True iff the module reports forensic-trace mode.
 */
async function probeIsForensicTrace(value: string): Promise<boolean> {
  const runtime = await loadTraceRuntime();
  const env = runtime.readEnvironment({ FORENSIC_TRACE: value });
  return runtime.runWithBankContext('beinleumi', () => runtime.mod.getLogFile() !== '', env);
}

/**
 * Append one FORENSIC_TRACE probe after all earlier probes finish.
 * @param previous - Promise carrying prior sequential probe results.
 * @param value - Value to probe next.
 * @returns Prior results plus the next probe result.
 */
async function appendProbeResult(
  previous: Promise<readonly boolean[]>,
  value: string,
): Promise<readonly boolean[]> {
  const results = await previous;
  const isForensic = await probeIsForensicTrace(value);
  return [...results, isForensic];
}

/**
 * Probe FORENSIC_TRACE values sequentially because each probe loads a fresh
 * process-global environment snapshot.
 * @param values - Values to probe in order.
 * @returns Probe results in the same order.
 */
function probeValuesSequentially(values: readonly string[]): Promise<readonly boolean[]> {
  const seed = Promise.resolve([] as readonly boolean[]);
  return values.reduce(appendProbeResult, seed);
}

describe('TraceConfig — FORENSIC_TRACE=true gates artefact emission', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('isForensicTrace is false when FORENSIC_TRACE is unset', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    const isMode = runtime.runWithBankContext(
      'beinleumi',
      () => runtime.mod.getLogFile() !== '',
      env,
    );
    expect(isMode).toBe(false);
  });

  it('isForensicTrace is false for false / 1 / 0 / yes / trace', async () => {
    const values = ['false', '1', '0', 'yes', 'trace'] as const;
    const results = await probeValuesSequentially(values);
    const hasAnyTrue = results.some(value => value);
    expect(hasAnyTrue).toBe(false);
  });

  it('isForensicTrace is true when FORENSIC_TRACE=true (case/space-insensitive)', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-true');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: '  TRUE  ',
      RUNS_ROOT: tmpRoot,
    });
    const isMode = runtime.runWithBankContext(
      'beinleumi',
      () => runtime.mod.getLogFile() !== '',
      env,
    );
    expect(isMode).toBe(true);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('off-trace: log artifact paths are empty', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    const observed = runtime.runWithBankContext(
      'beinleumi',
      () => ({ runFolder: runFolderOf(runtime.mod), logFile: runtime.mod.getLogFile() }),
      env,
    );
    expect(observed.runFolder).toBe('');
    expect(observed.logFile).toBe('');
  });

  it('on-trace: derives folder under RUNS_ROOT, creates it lazily', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-test');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const folder = runtime.runWithBankContext('beinleumi', () => runFolderOf(runtime.mod), env);
    const realRoot = fs.realpathSync(tmpRoot);
    const isUnderRoot = folder.startsWith(realRoot);
    const didCreate = fs.existsSync(folder);
    expect(folder).not.toBe('');
    expect(isUnderRoot).toBe(true);
    expect(didCreate).toBe(true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(folder).mode & 0o777;
      expect(mode).toBe(0o700);
    }
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('on-trace to off-trace: every warm artefact cache stops returning disk paths', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-flip');
    const runtime = await loadTraceRuntime();
    const onEnv = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const offEnv = runtime.readEnvironment({
      FORENSIC_TRACE: 'false',
      RUNS_ROOT: tmpRoot,
    });
    const warmed = runtime.runWithBankContext(
      'beinleumi',
      () => [runFolderOf(runtime.mod), runtime.mod.getLogFile()],
      onEnv,
    );
    const hasEmptyWarmed = warmed.some((value): boolean => value === '');
    expect(hasEmptyWarmed).toBe(false);
    const afterFalse = runtime.runWithBankContext(
      'beinleumi',
      () => [runFolderOf(runtime.mod), runtime.mod.getLogFile()],
      offEnv,
    );
    expect(afterFalse).toEqual(['', '']);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('on-trace: log file lives under the run folder', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-shared');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const observed = runtime.runWithBankContext(
      'beinleumi',
      () => ({ folder: runFolderOf(runtime.mod), logFile: runtime.mod.getLogFile() }),
      env,
    );
    const isLogUnder = observed.logFile.startsWith(observed.folder);
    const logBase = path.basename(observed.logFile);
    expect(isLogUnder).toBe(true);
    expect(logBase).toBe('pipeline.log');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('on-trace: run folder name uses DDMMYY-HHMMSScc format under <bank>/', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-fmt');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const folder = runtime.runWithBankContext('beinleumi', () => runFolderOf(runtime.mod), env);
    const expectedPipelineSeg = `${path.sep}pipeline${path.sep}`;
    const expectedBankSeg = `${path.sep}beinleumi${path.sep}`;
    const stampShape = /\d{2}-\d{2}-\d{4}_\d{8}$/;
    const hasShape = stampShape.test(folder);
    expect(folder).toContain(expectedPipelineSeg);
    expect(folder).toContain(expectedBankSeg);
    expect(hasShape).toBe(true);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('detectBankFromArgv returns "" when no bank test pattern is in argv', () => {
    const detected = detectBankFromArgv(['node', 'jest', 'src/Tests/Unit/Pipeline']);
    expect(detected).toBe('');
  });

  it('getRunFolder is cached — calling twice returns the same path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-cache');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const observed = runtime.runWithBankContext(
      'beinleumi',
      () => ({ a: runFolderOf(runtime.mod), b: runFolderOf(runtime.mod) }),
      env,
    );
    expect(observed.a).toBe(observed.b);
    expect(observed.a).not.toBe('');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getActiveRunId returns "" outside every run scope', async () => {
    const runtime = await loadTraceRuntime();
    const runId = runtime.mod.getActiveRunId();
    expect(runId).toBe('');
  });

  it('getActiveRunId is stable across calls within one run scope', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    const observed = runtime.runWithBankContext(
      'discount',
      () => ({ a: runtime.mod.getActiveRunId(), b: runtime.mod.getActiveRunId() }),
      env,
    );
    expect(observed.a).not.toBe('');
    expect(observed.a).toBe(observed.b);
  });

  it('getActiveRunId matches the on-disk run-folder leaf name (trace mode)', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-runid');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const observed = runtime.runWithBankContext(
      'discount',
      () => ({ runId: runtime.mod.getActiveRunId(), folder: runFolderOf(runtime.mod) }),
      env,
    );
    const leaf = path.basename(observed.folder);
    expect(observed.runId).toBe(leaf);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getActiveRunId is available off-trace (no folder created)', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    const observed = runtime.runWithBankContext(
      'hapoalim',
      () => ({ runId: runtime.mod.getActiveRunId(), folder: runFolderOf(runtime.mod) }),
      env,
    );
    const isWellFormed = RUN_ID_FORMAT_RE.test(observed.runId);
    expect(observed.runId).not.toBe('');
    expect(isWellFormed).toBe(true);
    expect(observed.folder).toBe('');
  });

  it('each run scope gets a new runId even for the same bank', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    const first = runtime.runWithBankContext('hapoalim', () => runtime.mod.getActiveRunId(), env);
    const second = runtime.runWithBankContext('hapoalim', () => runtime.mod.getActiveRunId(), env);
    const isSecondWellFormed = RUN_ID_FORMAT_RE.test(second);
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(isSecondWellFormed).toBe(true);
    expect(second).not.toBe(first);
  });

  it.each([
    ['amex', 'src/Tests/E2eReal/amex.e2e-real.test.ts'],
    ['beinleumi', String.raw`C:\Code\repo\src\Tests\E2eReal\beinleumi.e2e-real.test.ts`],
    ['discount', '/path/to/discount.e2e-real.test.ts'],
    ['hapoalim', './hapoalim.e2e-real.test.ts'],
    ['isracard', 'isracard.e2e-real.test.ts'],
    ['max', 'C:/repo/max.e2e-real.test.ts'],
    ['mizrahi', 'src/Tests/E2eReal/Mizrahi.e2e-real.test.ts'],
    ['onezero', 'onezero.e2e-real.test.ts'],
    ['pepper', 'pepper.e2e-real.test.ts'],
    ['visacal', 'visacal.e2e-real.test.ts'],
  ])('detectBankFromArgv recognises %s', (slug: string, argv: string) => {
    const detected = detectBankFromArgv(['node', 'jest', argv]);
    expect(detected).toBe(slug);
  });

  it('detectBankFromArgv recognises jest --testPathPatterns regex-escaped form', () => {
    const argvFlag = String.raw`--testPathPatterns=Beinleumi\.e2e-real\.test\.ts$`;
    const detected = detectBankFromArgv(['node', 'jest', argvFlag]);
    expect(detected).toBe('beinleumi');
  });

  it('detectBankFromArgv ignores text that does not match the test-file pattern', () => {
    const detected = detectBankFromArgv([
      'node',
      'jest',
      '--maxWorkers=2',
      '--testPathPatterns=Foo',
    ]);
    expect(detected).toBe('');
  });
});

describe('TraceConfig — run-scope bank and cache isolation', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('two run scopes for different banks get distinct folders and runIds', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-switch');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const first = runtime.runWithBankContext(
      'beinleumi',
      () => ({ folder: runFolderOf(runtime.mod), runId: runtime.mod.getActiveRunId() }),
      env,
    );
    const second = runtime.runWithBankContext(
      'discount',
      () => ({ folder: runFolderOf(runtime.mod), runId: runtime.mod.getActiveRunId() }),
      env,
    );
    expect(first.folder).toContain(`${path.sep}beinleumi${path.sep}`);
    expect(second.folder).toContain(`${path.sep}discount${path.sep}`);
    expect(second.folder).not.toBe(first.folder);
    expect(second.runId).not.toBe(first.runId);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('overlapping async scopes each keep their own bank and folder', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-overlap');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    /**
     * Observe the active bank's folder after yielding to the other scope.
     * @returns The log path and folder the scope resolves.
     */
    const observe = async (): Promise<{ bank: string; folder: string }> => {
      await Promise.resolve();
      return { bank: runtime.mod.getLogFile(), folder: runFolderOf(runtime.mod) };
    };
    const [first, second] = await Promise.all([
      runtime.runWithBankContext('beinleumi', observe, env),
      runtime.runWithBankContext('discount', observe, env),
    ]);
    expect(first.bank).toContain(`${path.sep}beinleumi${path.sep}`);
    expect(second.bank).toContain(`${path.sep}discount${path.sep}`);
    expect(first.folder).not.toBe(second.folder);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('the run-scope bank is trimmed and lowercased in the folder path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-normalise');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const folder = runtime.runWithBankContext(' Beinleumi ', () => runFolderOf(runtime.mod), env);
    expect(folder).toContain(`${path.sep}beinleumi${path.sep}`);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('a blank bank produces no artefacts', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-blank');
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({
      FORENSIC_TRACE: 'true',
      RUNS_ROOT: tmpRoot,
    });
    const observed = runtime.runWithBankContext(
      '   ',
      () => ({ folder: runFolderOf(runtime.mod), runId: runtime.mod.getActiveRunId() }),
      env,
    );
    expect(observed).toEqual({ folder: '', runId: '' });
    const didCreateRoot = fs.existsSync(tmpRoot);
    expect(didCreateRoot).toBe(false);
  });

  it('mints distinct stamps across same-tick, clock-rollback, and DST-fold local collisions', async () => {
    const runtime = await loadTraceRuntime();
    const env = runtime.readEnvironment({});
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(2026, 10, 1, 1, 30, 0, 0));
      const runIdSameTick1 = runtime.runWithBankContext(
        'beinleumi',
        () => runtime.mod.getActiveRunId(),
        env,
      );
      const runIdSameTick2 = runtime.runWithBankContext(
        'discount',
        () => runtime.mod.getActiveRunId(),
        env,
      );
      jest.setSystemTime(new Date(2026, 10, 1, 1, 29, 50, 0));
      const runIdRollback = runtime.runWithBankContext(
        'hapoalim',
        () => runtime.mod.getActiveRunId(),
        env,
      );
      const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(1);
      try {
        jest.setSystemTime(new Date(2026, 10, 1, 2, 30, 0, 0));
        const runIdDstFold = runtime.runWithBankContext(
          'beinleumi',
          () => runtime.mod.getActiveRunId(),
          env,
        );
        const seen = new Set([runIdSameTick1, runIdSameTick2, runIdRollback, runIdDstFold]);
        expect(seen.size).toBe(4);
      } finally {
        hoursSpy.mockRestore();
      }
    } finally {
      jest.useRealTimers();
    }
  });
});
