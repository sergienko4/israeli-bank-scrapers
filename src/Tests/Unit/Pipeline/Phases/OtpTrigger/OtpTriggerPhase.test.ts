/**
 * Unit tests for Phases/OtpTrigger/OtpTriggerPhase — phase class + compat step.
 */

import {
  createOtpTriggerPhase,
  OTP_TRIGGER_STEP,
  OtpTriggerPhase,
} from '../../../../../Scrapers/Pipeline/Phases/OtpTrigger/OtpTriggerPhase.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('OtpTriggerPhase', () => {
  it('has name "otp-trigger"', () => {
    const phase = createOtpTriggerPhase();
    expect(phase.name).toBe('otp-trigger');
  });

  it('is an instance of OtpTriggerPhase class', () => {
    const phase = createOtpTriggerPhase();
    expect(phase).toBeInstanceOf(OtpTriggerPhase);
  });

  it('returns new instances per factory call', () => {
    const a = createOtpTriggerPhase();
    const b = createOtpTriggerPhase();
    expect(a).not.toBe(b);
  });
});

describe('OTP_TRIGGER_STEP', () => {
  it('has name "otp-trigger"', () => {
    expect(OTP_TRIGGER_STEP.name).toBe('otp-trigger');
  });

  it('execute() succeeds and returns the input context', async () => {
    const ctx = makeMockContext();
    const result = await OTP_TRIGGER_STEP.execute(ctx, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    if (isOk(result)) expect(result.value).toBe(ctx);
  });
});

describe('OtpTriggerPhase lifecycle methods', () => {
  it('pre() delegates to executeTriggerPre', async () => {
    const phase = createOtpTriggerPhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('action() runs without executor', async () => {
    const { toActionCtx } = await import('../../Infrastructure/TestHelpers.js');
    const phase = createOtpTriggerPhase();
    const makeMockContextResult2 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult2, false);
    const result = await phase.action(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('post() runs', async () => {
    const phase = createOtpTriggerPhase();
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('final() runs', async () => {
    const phase = createOtpTriggerPhase();
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
