/**
 * Branch recovery #3 for OtpFillPhaseActions.
 * Covers: extractDeepPhoneHint !input.browser.has branch (L99 true),
 * maybeFastPathSuccess !input.mediator.has branch (L131 true),
 * and executeFillPost fast-path when there's no mediator.
 */

import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

describe('OtpFillPhaseActions — branch recovery #3', () => {
  it('executeFillPre: required=false + no OTP input + no dashboard → soft-skip success', async () => {
    // required=false (Hapoalim-style optional OTP via .withOtpFill(false)),
    // mediator+browser present, OTP input NOT found, dashboard NOT visible.
    // The optional-OTP safety valve in handleMissingOtpInput must succeed so
    // downstream phases can return zero accounts gracefully instead of
    // hard-failing the run.
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeFillPre(ctx, false);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('executeFillPre: default-arg (required=true) + no OTP input → hard fail', async () => {
    // Exercises the default-parameter branch — caller omits `required`.
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeFillPre(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });

  it('executeFillPre: required=true + no OTP input → hard fail', async () => {
    // required=true (Beinleumi-style mandatory OTP via .withOtpFill()),
    // input not found means we genuinely cannot proceed — must hard-fail
    // so the operator sees the failure rather than silently scraping nothing.
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeFillPre(ctx, true);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });

  it('executeFillPost: no mediator → succeed path at L317 guard', async () => {
    const ctx = makeMockContext();
    const result = await executeFillPost(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('executeFillFinal: no mediator → takes !mediator.has branch at L344', async () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const ctx = { ...base, mediator: none() };
    const result = await executeFillFinal(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('executeFillPost: error detected → rejects path', async () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const errorResult: IRaceResult = {
      ...NOT_FOUND_RESULT,
      found: true as const,
      value: 'Invalid OTP',
      candidate: { kind: 'textContent', value: 'Invalid OTP' },
    } as unknown as IRaceResult;
    const mediator = makeMockMediator({
      /**
       * First call detects error (POST error probe), later calls never reached.
       * @returns Error result on first call.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(errorResult),
      /**
       * URL getter.
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/otp',
    });
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executeFillPost(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });
});
