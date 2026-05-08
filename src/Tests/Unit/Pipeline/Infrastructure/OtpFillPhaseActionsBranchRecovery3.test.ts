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

  it('executeFillFinal: succeeds with cookie audit only — no discovery branch', async () => {
    // Phase 7 (2026-05-07) moved account discovery + readiness gating
    // into the dedicated ACCOUNT-RESOLVE phase. OTP-FILL.FINAL is now
    // a pure cookie-audit step; readiness/discovery failure modes are
    // covered by AccountResolveActions.test.ts.
    const mediator = makeMockMediator({
      /**
       * Returns one cookie so cookie-audit succeeds.
       * @returns Mock cookie array.
       */
      getCookies: (): Promise<readonly { name: string; domain: string; value: string }[]> =>
        Promise.resolve([{ name: 'SID', domain: 'bank.example.com', value: 'tok' }]),
      /**
       * URL getter.
       * @returns Mock URL.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/dashboard',
    });
    const base = makeMockContext();
    const ctx = {
      ...base,
      mediator: some(mediator),
    } as Parameters<typeof executeFillFinal>[0];
    const result = await executeFillFinal(ctx);
    expect(result.success).toBe(true);
  });

  it('executeFillPre: extractDeepPhoneHint runs page.evaluate body — covers inline arrow', async () => {
    // The mock's `evaluate(fn)` actually invokes `fn` against a fake
    // `globalThis.document` so the inline arrow inside
    // extractHintFromFrame (`(): string => document.body.innerText`)
    // is exercised — closes the last function-coverage gap on
    // OtpFillPhaseActions per Phase 7 audit.
    const page = makeScreenshotPage();
    const evaluatingPage = {
      ...page,
      /**
       * Synchronously invoke `fn` against a stub `document` to reach
       * the arrow body. Returns a phone-hint-shaped string so the
       * regex extractor also runs.
       * @param fn - Inner page-evaluate function.
       * @returns Promise resolving to the inner function's value.
       */
      evaluate: <T>(fn: () => T): Promise<T> => {
        const docStub = { body: { innerText: 'Sending code to ****1234' } };
        const prevGlobal = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = docStub;
        try {
          const value = fn();
          return Promise.resolve(value);
        } finally {
          (globalThis as { document?: unknown }).document = prevGlobal;
        }
      },
      /**
       * Single-frame stub — `frames()` must include something so the
       * reduce loop fires at least once.
       * @returns The page itself as the only frame.
       */
      frames: (): readonly (typeof page)[] => [page],
    };
    const browserPage = evaluatingPage as unknown as typeof page;
    const ctx = makeContextWithBrowser(browserPage);
    const result = await executeFillPre(ctx, false);
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
