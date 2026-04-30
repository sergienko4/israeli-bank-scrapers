/**
 * Unit tests for TraceConfig — single per-process artefact folder driven by
 * LOG_LEVEL=trace. Covers the off-trace empty-string contract and the
 * lazy-creation behaviour for the run / network / screenshot directories.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import type * as TraceConfigModuleType from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

type TraceConfigModule = typeof TraceConfigModuleType;

const TEMP_BASE = process.env.TEMP ?? 'C:/tmp';
const MODULE_PATH = '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

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
 * Probe a single LOG_LEVEL value against `isTraceMode()`. Extracted so the
 * batch test below doesn't rely on `await` inside a loop.
 * @param level - Value to set for `process.env.LOG_LEVEL`.
 * @returns True iff the module reports trace mode.
 */
async function probeIsTraceMode(level: string): Promise<boolean> {
  process.env.LOG_LEVEL = level;
  jest.resetModules();
  const mod = await loadTraceConfig();
  return mod.isTraceMode();
}

describe('TraceConfig — LOG_LEVEL=trace gates artefact emission', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalRunsRoot = process.env.RUNS_ROOT;

  afterEach(() => {
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
    jest.resetModules();
  });

  it('isTraceMode is false when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const isMode = mod.isTraceMode();
    expect(isMode).toBe(false);
  });

  it('isTraceMode is false when LOG_LEVEL is info / debug / warn / error', async () => {
    const probes = ['info', 'debug', 'warn', 'error'].map(probeIsTraceMode);
    const results = await Promise.all(probes);
    const hasAnyTrue = results.some(value => value);
    expect(hasAnyTrue).toBe(false);
  });

  it('isTraceMode is true when LOG_LEVEL=trace (case-insensitive)', async () => {
    process.env.LOG_LEVEL = 'TRACE';
    jest.resetModules();
    const mod = await loadTraceConfig();
    const isMode = mod.isTraceMode();
    expect(isMode).toBe(true);
  });

  it('off-trace: getRunFolder/getLogFile/getNetworkDumpDir/getScreenshotDir all empty', async () => {
    delete process.env.LOG_LEVEL;
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
    process.env.LOG_LEVEL = 'trace';
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
    process.env.LOG_LEVEL = 'trace';
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

  it('on-trace: run folder name uses DDMMYY-HHMMSScc format under <bank>/', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-fmt');
    process.env.LOG_LEVEL = 'trace';
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
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const date = new Date(2026, 3, 28, 18, 45, 30, 250);
    const stamp = mod.formatRunStamp(date);
    expect(stamp).toBe('28-04-2026_18453025');
  });

  it('detectBankFromArgv returns "" when no bank test pattern is in argv', async () => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const detected = mod.detectBankFromArgv();
    expect(detected).toBe('');
  });

  it('resetTraceConfigCache clears cached folders so a new call re-derives', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-reset');
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const folder1 = mod.getRunFolder();
    const wasReset = mod.resetTraceConfigCache();
    delete process.env.LOG_LEVEL;
    const folder2 = mod.getRunFolder();
    expect(folder1).not.toBe('');
    expect(wasReset).toBe(true);
    expect(folder2).toBe('');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getRunFolder is cached — calling twice returns the same path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-cache');
    process.env.LOG_LEVEL = 'trace';
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
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
    const mod = await loadTraceConfig();
    mod.setActiveBank('beinleumi');
    const a = mod.getNetworkDumpDir();
    const b = mod.getNetworkDumpDir();
    expect(a).toBe(b);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getScreenshotDir is cached across calls', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-shot');
    process.env.LOG_LEVEL = 'trace';
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
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await loadTraceConfig();
    const date = new Date(2026, 0, 2, 3, 4, 5, 60);
    const stamp = mod.formatRunStamp(date);
    expect(stamp).toBe('02-01-2026_03040506');
  });

  it('on-trace: bank slug derived from argv shows up in folder path', async () => {
    const tmpRoot = makeTmpRoot('traceconfig-bank');
    const originalArgv = process.argv;
    process.argv = ['node', 'jest', 'src/Tests/E2eReal/beinleumi.e2e-real.test.ts'];
    process.env.LOG_LEVEL = 'trace';
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
