/**
 * Unit tests for Types/RunLabel — per-run screenshot path builder. The
 * builder is gated by `LOG_LEVEL=trace` (single source of truth via
 * TraceConfig); off-trace it returns the empty string so callers can skip
 * the screenshot. The on-trace path lives inside the run folder under
 * `<RUNS_ROOT>/<bank>/<DDMMYY-HHMMSScc>/screenshots/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { jest } from '@jest/globals';

describe('screenshotPath', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalRunsRoot = process.env.RUNS_ROOT;
  const millis = Date.now();
  const tmpStamp = String(millis);
  const tmpRoot = path.join(process.env.TEMP ?? 'C:/tmp', `runlabel-test-${tmpStamp}`);

  beforeEach(() => {
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = tmpRoot;
    jest.resetModules();
  });

  afterEach(() => {
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty string when LOG_LEVEL is not trace', async () => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const mod = await import('../../../../Scrapers/Pipeline/Types/RunLabel.js');
    const result = mod.screenshotPath('pepper', 'otp-fill');
    expect(result).toBe('');
  });

  it('emits bank-label-timestamp inside the trace screenshots dir when bank is provided', async () => {
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.setActiveBank('pepper');
    const mod = await import('../../../../Scrapers/Pipeline/Types/RunLabel.js');
    const result = mod.screenshotPath('pepper', 'otp-fill');
    expect(result).toContain(`${path.sep}screenshots${path.sep}`);
    expect(result).toMatch(/pepper-otp-fill-\d{8}-\d{6}\.png$/);
  });

  it('uses the generic prefix when bank is empty', async () => {
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.setActiveBank('beinleumi');
    const mod = await import('../../../../Scrapers/Pipeline/Types/RunLabel.js');
    const result = mod.screenshotPath('', 'login-probe');
    expect(result).toMatch(/screenshot-login-probe-\d{8}-\d{6}\.png$/);
  });

  it('uses uppercase bank slug unchanged', async () => {
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.setActiveBank('onezero');
    const mod = await import('../../../../Scrapers/Pipeline/Types/RunLabel.js');
    const result = mod.screenshotPath('OneZero', 'dash-ready');
    expect(result).toMatch(/OneZero-dash-ready-\d{8}-\d{6}\.png$/);
  });
});
