/**
 * Unit tests for Phases/OtpFill/OtpFillPhase — phase class + compat step.
 */

import {
  createOtpFillPhase,
  OTP_FILL_STEP,
  OtpFillPhase,
} from '../../../../../Scrapers/Pipeline/Phases/OtpFill/OtpFillPhase.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeMockActionExecutor, toActionCtx } from '../../Infrastructure/TestHelpers.js';

describe('OtpFillPhase', () => {
  it('has name "otp-fill"', () => {
    const phase = createOtpFillPhase();
    expect(phase.name).toBe('otp-fill');
  });

  it('is an instance of OtpFillPhase class', () => {
    const phase = createOtpFillPhase();
    expect(phase).toBeInstanceOf(OtpFillPhase);
  });
});

describe('OTP_FILL_STEP', () => {
  it('has name "otp-fill"', () => {
    expect(OTP_FILL_STEP.name).toBe('otp-fill');
  });

  it('execute() returns succeed(input)', async () => {
    const ctx = makeMockContext();
    const result = await OTP_FILL_STEP.execute(ctx, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });
});

describe('OtpFillPhase lifecycle methods', () => {
  it('pre() delegates to executeFillPre', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('action() succeeds when no executor', async () => {
    const phase = createOtpFillPhase();
    const makeMockContextResult3 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult3, false);
    const result = await phase.action(ctx, ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('post() succeeds when no mediator', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('final() stamps diagnostics', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('action() fails when retriever missing after executor present', async () => {
    const phase = createOtpFillPhase();
    const makeMockActionExecutorResult8 = makeMockActionExecutor();
    const makeMockContextResult7 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult7, makeMockActionExecutorResult8);
    const result = await phase.action(ctx, ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });
});
