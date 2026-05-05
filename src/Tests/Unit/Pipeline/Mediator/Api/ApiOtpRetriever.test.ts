/**
 * Unit tests for ApiOtpRetriever — generic OTP helper pickers.
 * Covers options-over-creds precedence, creds fallback, neither-present
 * false return, and phone-hint binding closure behavior.
 */

import {
  bindPhoneHint,
  type IOtpCredsView,
  type OtpRetrieverFn,
  pickRetriever,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiOtpRetriever.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Build a minimal pipeline-context stub whose only populated slot is
 * options.otpCodeRetriever.
 * @param retriever - Optional retriever.
 * @returns Pipeline-context stub.
 */
function makeCtx(retriever?: OtpRetrieverFn): IPipelineContext {
  return {
    options: { otpCodeRetriever: retriever },
  } as unknown as IPipelineContext;
}

/**
 * OtpRetrieverFn that ignores its hint and returns a constant label.
 * @param label - Label to return.
 * @returns Retriever closure.
 */
function makeConstantRetriever(label: string): OtpRetrieverFn {
  return async (): Promise<string> => {
    await Promise.resolve();
    return label;
  };
}

/**
 * OtpRetrieverFn that records each hint into the supplied array.
 * @param captures - Mutable array that collects hints per invocation.
 * @param label - Label returned by every call.
 * @returns Retriever closure.
 */
function makeRecordingRetriever(captures: string[], label: string): OtpRetrieverFn {
  return async (hint): Promise<string> => {
    await Promise.resolve();
    captures.push(hint);
    return label;
  };
}

describe('ApiOtpRetriever.pickRetriever precedence', () => {
  it('prefers options over creds when both provide a retriever', (): void => {
    const fromOptions = makeConstantRetriever('opts');
    const fromCreds = makeConstantRetriever('creds');
    const ctx = makeCtx(fromOptions);
    const creds: IOtpCredsView = { otpCodeRetriever: fromCreds };
    const picked = pickRetriever(ctx, creds);
    expect(picked).toBe(fromOptions);
  });

  it('falls back to creds when options is undefined', (): void => {
    const fromCreds = makeConstantRetriever('creds');
    const ctx = makeCtx();
    const creds: IOtpCredsView = { otpCodeRetriever: fromCreds };
    const picked = pickRetriever(ctx, creds);
    expect(picked).toBe(fromCreds);
  });

  it('returns false when neither options nor creds supply one', (): void => {
    const ctx = makeCtx();
    const creds: IOtpCredsView = {};
    const picked = pickRetriever(ctx, creds);
    expect(picked).toBe(false);
  });
});

describe('ApiOtpRetriever.bindPhoneHint closure', () => {
  it('forwards the bound phone hint verbatim to the inner retriever', async (): Promise<void> => {
    const captures: string[] = [];
    const raw = makeRecordingRetriever(captures, 'fixt-otp-1a2b');
    const bound = bindPhoneHint(raw, '+972501234567');
    const code = await bound();
    expect(code).toBe('fixt-otp-1a2b');
    expect(captures).toEqual(['+972501234567']);
  });

  it('can be invoked multiple times with the same bound hint', async (): Promise<void> => {
    const captures: string[] = [];
    const raw = makeRecordingRetriever(captures, '111111');
    const bound = bindPhoneHint(raw, '+972500000001');
    await bound();
    await bound();
    expect(captures).toEqual(['+972500000001', '+972500000001']);
  });
});
