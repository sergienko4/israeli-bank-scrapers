/**
 * Unit tests for OtpTriggerPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import type { Page } from 'playwright-core';

import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeTriggerAction,
  executeTriggerFinal,
  executeTriggerPost,
  executeTriggerPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IResolvedTarget } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/** Mock target for OTP trigger. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'button',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Send SMS',
};

describe('executeTriggerPre', () => {
  it('returns succeed when mediator missing', async () => {
    const ctx = makeMockContext();
    const result = await executeTriggerPre(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('returns succeed when browser missing', async () => {
    const ctx = makeMockContext({ mediator: some({} as unknown as IElementMediator) });
    const result = await executeTriggerPre(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('succeeds passively when OTP trigger not detected and OTP not required', async () => {
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult3);
    const result = await executeTriggerPre(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });
});

describe('executeTriggerAction', () => {
  it('returns succeed when no executor', async () => {
    const makeMockContextResult5 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult5, false);
    const result = await executeTriggerAction(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('fails when no OTP trigger target in diagnostics', async () => {
    const makeMockActionExecutorResult8 = makeMockActionExecutor();
    const makeMockContextResult7 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult7, makeMockActionExecutorResult8);
    const result = await executeTriggerAction(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  it('succeeds after clicking pre-resolved OTP trigger', async () => {
    const makeMockActionExecutorResult11 = makeMockActionExecutor();
    const makeMockContextResult10 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult10, makeMockActionExecutorResult11, {
      otpTriggerTarget: MOCK_TARGET,
    });
    const result = await executeTriggerAction(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('fails when clickElement rejects', async () => {
    const failExec = makeMockActionExecutor({
      /**
       * Rejects to simulate failure.
       * @returns Rejected promise.
       */
      clickElement: () => Promise.reject(new Error('click failed')),
    });
    const makeMockContextResult13 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult13, failExec, { otpTriggerTarget: MOCK_TARGET });
    const result = await executeTriggerAction(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(false);
  });
});

describe('executeTriggerPost', () => {
  it('always succeeds without browser', async () => {
    const ctx = makeMockContext();
    const result = await executeTriggerPost(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });

  it('succeeds with browser + screenshot', async () => {
    const makeScreenshotPageResult16 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult16);
    const result = await executeTriggerPost(ctx);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });
});

describe('executeTriggerFinal', () => {
  it('stamps diagnostics lastAction for handoff', async () => {
    const ctx = makeMockContext();
    const result = await executeTriggerFinal(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('otp-trigger-final');
    }
  });

  it('preserves other diagnostics fields', async () => {
    const ctx = makeMockContext({
      diagnostics: {
        loginUrl: 'https://x',
        finalUrl: none(),
        loginStartMs: 0,
        fetchStartMs: none(),
        lastAction: 'prev',
        pageTitle: none(),
        warnings: [],
      },
    });
    const result = await executeTriggerFinal(ctx);
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.loginUrl).toBe('https://x');
    }
  });
});

// ── Phone-hint extraction branches (PRE) ────────────────────────────
describe('executeTriggerPre — phone hint extraction', () => {
  it('extracts last digits from page body text with masked phone', async () => {
    /** Page exposing body text with phone pattern. */
    const pageWithHint = makeScreenshotPage('Code sent to *****4321');
    const base = makeContextWithBrowser(pageWithHint);
    const ctx = {
      ...base,
      /**
       * OTP NOT enabled so missing trigger is OK.
       */
      config: { ...base.config, otp: { enabled: false } },
    };
    const result = await executeTriggerPre(ctx);
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(true);
  });

  it('handles rejected page.evaluate gracefully', async () => {
    const page = makeScreenshotPage();
    const rejectingPage = {
      ...page,
      /**
       * Reject body text read.
       * @returns Rejected.
       */
      evaluate: (): Promise<string> => Promise.reject(new Error('eval fail')),
    };
    const base = makeContextWithBrowser(rejectingPage as unknown as Page);
    const ctx = {
      ...base,
      config: { ...base.config, otp: { enabled: false } },
    };
    const result = await executeTriggerPre(ctx);
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(true);
  });

  it('fails when OTP enabled + no trigger detected (not mock mode)', async () => {
    const originalMode = process.env.MOCK_MODE;
    delete process.env.MOCK_MODE;
    try {
      const makeScreenshotPageResult22 = makeScreenshotPage();
      const base = makeContextWithBrowser(makeScreenshotPageResult22);
      const ctx = {
        ...base,
        config: { ...base.config, otp: { enabled: true } },
      };
      const result = await executeTriggerPre(ctx);
      // Default mediator returns NOT_FOUND for resolveVisible — trigger absent.
      const isOkResult23 = isOk(result);
      expect(isOkResult23).toBe(false);
    } finally {
      if (originalMode !== undefined) process.env.MOCK_MODE = originalMode;
    }
  });
});
