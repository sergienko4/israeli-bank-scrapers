/**
 * Unit tests for TraceConfig — single per-process artefact folder driven by
 * FORENSIC_TRACE=true. Covers the off-forensic empty-string contract and the
 * lazy-creation behaviour for the run / network / screenshot directories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import type * as TraceConfigModuleType from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

type TraceConfigModule = typeof TraceConfigModuleType;

const TEMP_BASE = process.env.TEMP ?? 'C:/tmp';
const MODULE_PATH = '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

/** Format of the per-run identifier — `DD-MM-YYYY_HHMMSScc`. */
const RUN_ID_FORMAT_RE = /^\d{2}-\d{2}-\d{4}_\d{8}$/;

/**
 * Dynamically import the TraceConfig module under test with full typing,
 * avoiding the implicit `any` that bare `await import(...)` returns.
 * @returns The typed module exports.
 */
async function loadTraceConfig(): Promise<TraceConfigModule> {
  return (await import(MODULE_PATH)) as TraceConfigModule;
}

/**
 * Build a unique tmp directory path under TEMP_BASE for a single test.
 * Avoids inlining `String(Date.now())` (a forbidden nested call) at every
 * site.
 * @param prefix - Folder-name prefix.
 * @returns Absolute path to the tmp directory (not yet created).
 */
function makeTmpRoot(prefix: string): string {
  const millis = Date.now();
  const stamp = String(millis);
  return path.join(TEMP_BASE, `${prefix}-${stamp}`);
}

/**
 * Probe a single FORENSIC_TRACE value against `isForensicTrace()`. Extracted
 * so the batch test below doesn't rely on `await` inside a loop.
 * @param value - Value to set for `process.env.FORENSIC_TRACE`.
 * @returns True iff the module reports forensic-trace mode.
 */
async function probeIsForensicTrace(value: string): Promise<boolean> {
  process.env.FORENSIC_TRACE = value;
  jest.resetModules();
  const mod = await loadTraceConfig();
  return mod.isForensicTrace();
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
 * Probe FORENSIC_TRACE values sequentially because each probe mutates
 * process-global environment and Jest module state.
 * @param values - Values to probe in order.
 * @returns Probe results in the same order.
 */
function probeValuesSequentially(values: readonly string[]): Promise<readonly boolean[]> {
  const seed = Promise.resolve([] as readonly boolean[]);
  return values.reduce(appendProbeResult, seed);
}

describe('TraceConfig — FORENSIC_TRACE=true gates artefact emission', () => {
  const originalForensic = process.env.FORENSIC_TRACE;
  const originalRunsRoot = process.env.RUNS_ROOT;

  afterEach(() => {
    if (originalForensic === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = originalForensic;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    jest.resetModules();
  });

  it('isForensicTrace is false when FORENSIC_TRACE is unset', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const isMode = mod.isForensicTrace();
    expect(isMode).toBe(false);
  });

  it('isForensicTrace is false for false / 1 / 0 / yes / trace', async () => {
    const values = ['false', '1', '0', 'yes', 'trace'] as const;
    const results = await probeValuesSequentially(values);
    const hasAnyTrue = results.some(value => value);
    expect(hasAnyTrue).toBe(false);
  });

  it('isForensicTrace is true when FORENSIC_TRACE=true (case/space-insensitive)', async () => {
    process.env.FORENSIC_TRACE = '  TRUE  ';
    jest.resetModules();
    const mod = await loadTraceConfig();
    const isMode = mod.isForensicTrace();
    expect(isMode).toBe(true);
  });

  it('off-trace: getRunFolder/getLogFile/getNetworkDumpDir/getScreenshotDir all empty', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const runFolder = mod.getRunFolder();
    const logFile = mod.getLogFile();
    const networkDir = mod.getNetworkDumpDir();
    const screenshotDir = mod.getScreenshotDir();
    expect(runFolder).toBe('');
    expect(logFile).toBe('');
    expect(networkDir).toBe('');
    expect(screenshotDir).toBe('');
  });

  it('on-trace: derives folder under RUNS_ROOT, creates it lazily', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-test');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const folder = mod.getRunFolder();
    const isUnderRoot = folder.startsWith(tmpRoot);
    const didCreate = fs.existsSync(folder);
    expect(folder).not.toBe('');
    expect(isUnderRoot).toBe(true);
    expect(didCreate).toBe(true);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('on-trace: log file, network dir, screenshot dir all share the same root', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-shared');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const root = mod.getRunFolder();
    const logFile = mod.getLogFile();
    const networkDir = mod.getNetworkDumpDir();
    const screenshotDir = mod.getScreenshotDir();
    const logBase = path.basename(logFile);
    const netBase = path.basename(networkDir);
    const shotBase = path.basename(screenshotDir);
    const isLogUnder = logFile.startsWith(root);
    const isNetUnder = networkDir.startsWith(root);
    const isShotUnder = screenshotDir.startsWith(root);
    const didCreateNet = fs.existsSync(networkDir);
    const didCreateShot = fs.existsSync(screenshotDir);
    expect(isLogUnder).toBe(true);
    expect(isNetUnder).toBe(true);
    expect(isShotUnder).toBe(true);
    expect(logBase).toBe('pipeline.log');
    expect(netBase).toBe('network');
    expect(shotBase).toBe('screenshots');
    expect(didCreateNet).toBe(true);
    expect(didCreateShot).toBe(true);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('off-trace: getSubStepNetworkDumpDir returns empty string', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const subDir = mod.getSubStepNetworkDumpDir('home', 'PRE');
    expect(subDir).toBe('');
  });

  it('on-trace: getSubStepNetworkDumpDir creates a sub-folder under network/', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-substep');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const subDir1 = mod.getSubStepNetworkDumpDir('home', 'PRE');
    const subDir2 = mod.getSubStepNetworkDumpDir('home', 'PRE');
    const didCreate = fs.existsSync(subDir1);
    expect(subDir1).not.toBe('');
    expect(didCreate).toBe(true);
    expect(subDir2).toBe(subDir1);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('on-trace: run folder name uses DDMMYY-HHMMSScc format under <bank>/', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-fmt');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const folder = mod.getRunFolder();
    const expectedPipelineSeg = `${path.sep}pipeline${path.sep}`;
    const expectedBankSeg = `${path.sep}beinleumi${path.sep}`;
    const stampShape = /\d{2}-\d{2}-\d{4}_\d{8}$/;
    const hasShape = stampShape.test(folder);
    expect(folder).toContain(expectedPipelineSeg);
    expect(folder).toContain(expectedBankSeg);
    expect(hasShape).toBe(true);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('formatRunStamp produces DDMMYY-HHMMSScc for a known Date', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const date = new Date(2026, 3, 28, 18, 45, 30, 250);
    const stamp = mod.formatRunStamp(date);
    expect(stamp).toBe('28-04-2026_18453025');
  });

  it('detectBankFromArgv returns "" when no bank test pattern is in argv', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const detected = mod.detectBankFromArgv();
    expect(detected).toBe('');
  });

  it('resetTraceConfigCache clears cached folders so a new call re-derives', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-reset');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const folder1 = mod.getRunFolder();
    const wasReset = mod.resetTraceConfigCache();
    delete process.env.FORENSIC_TRACE;
    const folder2 = mod.getRunFolder();
    expect(folder1).not.toBe('');
    expect(wasReset).toBe(true);
    expect(folder2).toBe('');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getRunFolder is cached — calling twice returns the same path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-cache');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const a = mod.getRunFolder();
    const b = mod.getRunFolder();
    expect(a).toBe(b);
    expect(a).not.toBe('');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getNetworkDumpDir is cached across calls', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-net');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const a = mod.getNetworkDumpDir();
    const b = mod.getNetworkDumpDir();
    expect(a).toBe(b);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getActiveRunId returns "" when no bank has been registered', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const runId = mod.getActiveRunId();
    expect(runId).toBe('');
  });

  it('getActiveRunId is stable across calls within one process', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('discount');
    const a = mod.getActiveRunId();
    const b = mod.getActiveRunId();
    expect(a).not.toBe('');
    expect(a).toBe(b);
  });

  it('getActiveRunId matches the on-disk run-folder leaf name (trace mode)', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-runid');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('discount');
    const runId = mod.getActiveRunId();
    const folder = mod.getRunFolder();
    const leaf = path.basename(folder);
    expect(runId).toBe(leaf);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getActiveRunId is available off-trace (no folder created)', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('hapoalim');
    const runId = mod.getActiveRunId();
    const folder = mod.getRunFolder();
    const isWellFormed = RUN_ID_FORMAT_RE.test(runId);
    expect(runId).not.toBe('');
    expect(isWellFormed).toBe(true);
    expect(folder).toBe('');
  });

  it('resetTraceConfigCache clears the runId so a new call re-derives', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('hapoalim');
    const before = mod.getActiveRunId();
    mod.resetTraceConfigCache();
    mod.setActiveBank('hapoalim');
    const after = mod.getActiveRunId();
    const isAfterWellFormed = RUN_ID_FORMAT_RE.test(after);
    expect(before).not.toBe('');
    expect(after).not.toBe('');
    // Both are well-formed; equality is timing-dependent so we only
    // assert format stability.
    expect(isAfterWellFormed).toBe(true);
  });

  it('getScreenshotDir is cached across calls', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-shot');
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const a = mod.getScreenshotDir();
    const b = mod.getScreenshotDir();
    expect(a).toBe(b);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.each([
    ['amex', 'src/Tests/E2eReal/amex.e2e-real.test.ts'],
    ['beinleumi', String.raw`C:\Code\repo\src\Tests\E2eReal\beinleumi.e2e-real.test.ts`],
    ['discount', '/path/to/discount.e2e-real.test.ts'],
    ['hapoalim', './hapoalim.e2e-real.test.ts'],
    ['isracard', 'isracard.e2e-real.test.ts'],
    ['max', 'C:/repo/max.e2e-real.test.ts'],
    ['onezero', 'onezero.e2e-real.test.ts'],
    ['pepper', 'pepper.e2e-real.test.ts'],
    ['visacal', 'visacal.e2e-real.test.ts'],
  ])('detectBankFromArgv recognises %s', async (slug: string, argv: string) => {
    const originalArgv = process.argv;
    process.argv = ['node', 'jest', argv];
    jest.resetModules();
    const mod = await loadTraceConfig();
    const detected = mod.detectBankFromArgv();
    process.argv = originalArgv;
    expect(detected).toBe(slug);
  });

  it('detectBankFromArgv recognises jest --testPathPatterns regex-escaped form', async () => {
    const originalArgv = process.argv;
    const argvFlag = String.raw`--testPathPatterns=Beinleumi\.e2e-real\.test\.ts$`;
    process.argv = ['node', 'jest', argvFlag];
    jest.resetModules();
    const mod = await loadTraceConfig();
    const detected = mod.detectBankFromArgv();
    process.argv = originalArgv;
    expect(detected).toBe('beinleumi');
  });

  it('detectBankFromArgv ignores text that does not match the test-file pattern', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'jest', '--maxWorkers=2', '--testPathPatterns=Foo'];
    jest.resetModules();
    const mod = await loadTraceConfig();
    const detected = mod.detectBankFromArgv();
    process.argv = originalArgv;
    expect(detected).toBe('');
  });

  it('formatRunStamp pads single-digit day/month/hour/minute/second/centisecond', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const date = new Date(2026, 0, 2, 3, 4, 5, 60);
    const stamp = mod.formatRunStamp(date);
    expect(stamp).toBe('02-01-2026_03040506');
  });

  it('setActiveBank rejects empty string and unknown slugs', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const acceptedEmpty = mod.setActiveBank('');
    const acceptedUnknown = mod.setActiveBank('not-a-real-bank');
    const acceptedWhitespace = mod.setActiveBank('   ');
    expect(acceptedEmpty).toBe(false);
    expect(acceptedUnknown).toBe(false);
    expect(acceptedWhitespace).toBe(false);
  });

  it('setActiveBank accepts a known slug case-insensitively', async () => {
    delete process.env.FORENSIC_TRACE;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const accepted = mod.setActiveBank(' Beinleumi ');
    expect(accepted).toBe(true);
  });

  it('on-trace: bank slug derived from argv shows up in folder path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-bank');
    const originalArgv = process.argv;
    process.argv = ['node', 'jest', 'src/Tests/E2eReal/beinleumi.e2e-real.test.ts'];
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const folder = mod.getRunFolder();
    const expectedSeg = `${path.sep}beinleumi${path.sep}`;
    process.argv = originalArgv;
    expect(folder).toContain(expectedSeg);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
