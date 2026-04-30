/**
 * Unit tests for Mediator/Otp/OtpShared — OTP_FALLBACK + otpScreenshot catch lambda.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  NOT_FOUND,
  OTP_FALLBACK,
  otpScreenshot,
  readDiagString,
  readDiagTarget,
  unwrapProbe,
} from '../../../../Scrapers/Pipeline/Mediator/Otp/OtpShared.js';
import type { Option } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IBrowserState,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Browser state Option alias — hides `as never` cast pattern. */
type IBrowserStateOption = Option<IBrowserState>;
/** Diagnostics alias — hides `as never` cast pattern. */
type IDiagnosticsShape = IActionContext['diagnostics'];

describe('OTP_FALLBACK', () => {
  it('returns succeed(NOT_FOUND)', () => {
    const result = OTP_FALLBACK();
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(NOT_FOUND);
  });
});

describe('unwrapProbe', () => {
  it('returns race value when ok and found', () => {
    const race = { ...NOT_FOUND, found: true as const, value: 'V' };
    const succeedResult1 = succeed(race);
    const unwrapped = unwrapProbe(succeedResult1);
    expect(unwrapped.found).toBe(true);
  });

  it('returns NOT_FOUND when probe failed', () => {
    const failResult2 = fail(ScraperErrorTypes.Generic, 'boom');
    const unwrapped = unwrapProbe(failResult2);
    expect(unwrapped.found).toBe(false);
  });

  it('returns NOT_FOUND when success but found=false', () => {
    const succeedResult3 = succeed(NOT_FOUND);
    const unwrapped = unwrapProbe(succeedResult3);
    expect(unwrapped.found).toBe(false);
  });
});

describe('otpScreenshot', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalRunsRoot = process.env.RUNS_ROOT;

  afterEach(() => {
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = originalRunsRoot;
  });

  it('returns empty string when browser is not present', async () => {
    const ctx = makeMockContext({ browser: none() });
    const result = await otpScreenshot(ctx, 'stage');
    expect(result).toBe('');
  });

  it('returns empty string when LOG_LEVEL is not trace (off-trace = no screenshot)', async () => {
    delete process.env.LOG_LEVEL;
    const page = {
      /**
       * Stub screenshot — should not be invoked off-trace.
       * @returns Resolves to undefined.
       */
      screenshot: (): Promise<unknown> => Promise.resolve(undefined),
    };
    const ctx = makeMockContext({ browser: some({ page }) as unknown as IBrowserStateOption });
    const result = await otpScreenshot(ctx, 'otp-trigger');
    expect(result).toBe('');
  });

  it('returns the path when screenshot succeeds (LOG_LEVEL=trace)', async () => {
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = String.raw`C:\tmp\otpshared-test-runs`;
    // Re-import RunLabel/TraceConfig fresh so cached folders pick up new env.
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.resetTraceConfigCache();
    tc.setActiveBank('beinleumi');
    const page = {
      /**
       * Stub screenshot that resolves successfully.
       * @returns Resolves to undefined.
       */
      screenshot: (): Promise<unknown> => Promise.resolve(undefined),
    };
    const ctx = makeMockContext({ browser: some({ page }) as unknown as IBrowserStateOption });
    const result = await otpScreenshot(ctx, 'otp-trigger');
    expect(typeof result).toBe('string');
    expect(result).toContain('otp-trigger');
  });

  it('swallows screenshot rejection via .catch (line 61 lambda)', async () => {
    process.env.LOG_LEVEL = 'trace';
    process.env.RUNS_ROOT = String.raw`C:\tmp\otpshared-test-runs`;
    const tc = await import('../../../../Scrapers/Pipeline/Types/TraceConfig.js');
    tc.resetTraceConfigCache();
    tc.setActiveBank('beinleumi');
    const page = {
      /**
       * Stub screenshot that rejects so we exercise the .catch lambda.
       * @returns Rejects with a fake disk-full error.
       */
      screenshot: (): Promise<never> => Promise.reject(new Error('disk full')),
    };
    const ctx = makeMockContext({ browser: some({ page }) as unknown as IBrowserStateOption });
    const result = await otpScreenshot(ctx, 'otp-fill');
    expect(typeof result).toBe('string');
  });
});

describe('readDiagTarget / readDiagString', () => {
  const target: IResolvedTarget = {
    contextId: 'main',
    selector: '#t',
    kind: 'css',
    candidateValue: 't',
  };

  it('readDiagTarget returns false when key missing', () => {
    const readDiagTargetResult4 = readDiagTarget({} as unknown as IDiagnosticsShape, 'missing');
    expect(readDiagTargetResult4).toBe(false);
  });

  it('readDiagTarget returns target when key present', () => {
    const diag = { otpTrigger: target } as unknown as IDiagnosticsShape;
    const result = readDiagTarget(diag, 'otpTrigger');
    expect(result).toEqual(target);
  });

  it('readDiagString returns empty string when key missing', () => {
    const readDiagStringResult5 = readDiagString({} as unknown as IDiagnosticsShape, 'missing');
    expect(readDiagStringResult5).toBe('');
  });

  it('readDiagString returns value when present', () => {
    const diag = { phoneHint: '1234' } as unknown as IDiagnosticsShape;
    const readDiagStringResult6 = readDiagString(diag, 'phoneHint');
    expect(readDiagStringResult6).toBe('1234');
  });
});
