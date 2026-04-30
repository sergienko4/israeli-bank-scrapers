/**
 * Branch recovery tests for OtpFillPhaseActions.
 * Targets: line 129 RHS of `?? true` (config.otp undefined, defaults to required).
 * When otp config entirely absent, executeFillPre PRE must still behave correctly —
 * goes through handleMissingOtpInput → maybeFastPathSuccess and exercises the
 * nullish-coalescing RHS.
 */

import { executeFillPre } from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeContextWithBrowser } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

describe('OtpFillPhaseActions — branch recovery', () => {
  it('line 129 path 1: config has no otp block → required defaults via `?? true`', async () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    // Strip any otp entry from config so `input.config.otp?.required` is undefined
    // and the nullish-coalescing right-hand side (`?? true`) is taken.
    const bareConfig: typeof base.config = { ...base.config };
    delete (bareConfig as { otp?: unknown }).otp;
    const ctx = { ...base, config: bareConfig };
    const result = await executeFillPre(ctx);
    const isOkFlag = isOk(result);
    // When otp is required (via defaulted `?? true`) and input is not found,
    // handleMissingOtpInput falls through to hard fail (no MOCK_MODE in tests).
    expect(isOkFlag).toBe(false);
  });

  it('line 129 path 1: otp block present but required field missing → defaults true', async () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    // otp.required absent (undefined) → `otp?.required` = undefined → `?? true` → true
    const ctx = {
      ...base,
      config: { ...base.config, otp: { enabled: true } as { enabled: true; required?: boolean } },
    };
    const result = await executeFillPre(ctx);
    const isOkFlag = isOk(result);
    expect(isOkFlag).toBe(false);
  });
});
