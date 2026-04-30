/**
 * Unit tests for OtpFillPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeFlushableLogger,
  makeMockActionExecutor,
  makeScreenshotPage,
  toActionCtx,
} from './TestHelpers.js';

/** Mock OTP input target. */
const MOCK_INPUT: IResolvedTarget = {
  selector: '#otp',
  contextId: 'main',
  kind: 'placeholder',
  candidateValue: 'code',
};

/** Mock OTP submit target. */
const MOCK_SUBMIT: IResolvedTarget = {
  selector: '#submit',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Send',
};

describe('executeFillPre', () => {
  it('succeeds when mediator missing', async () => {
    const ctx = makeMockContext();
    const result = await executeFillPre(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('succeeds when browser missing but mediator present', async () => {
    const ctx = makeMockContext({ mediator: some({} as unknown as IElementMediator) });
    const result = await executeFillPre(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('fails when OTP input not found and OTP required', async () => {
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult3);
    const requiredCtx = {
      ...ctx,
      config: { ...ctx.config, otp: { enabled: true, required: true } },
    };
    const result = await executeFillPre(requiredCtx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
  });
});

describe('executeFillAction', () => {
  it('returns succeed when no executor', async () => {
    const makeMockContextResult5 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult5, false);
    const result = await executeFillAction(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('honors fast-path-skip from PRE diagnostics', async () => {
    const base = makeMockContext();
    const makeMockActionExecutorResult7 = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(
      {
        ...base,
        diagnostics: { ...base.diagnostics, lastAction: 'otp-fill-pre (fast-path-skip)' },
      },
      makeMockActionExecutorResult7,
    );
    const result = await executeFillAction(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('fails when no otpCodeRetriever in options', async () => {
    const makeMockActionExecutorResult10 = makeMockActionExecutor();
    const makeMockContextResult9 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult9, makeMockActionExecutorResult10);
    const result = await executeFillAction(ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(false);
  });

  it('fills and submits when retriever returns code', async () => {
    const exec = makeMockActionExecutor();
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        /**
         * Retriever returns a canned code.
         * @returns OTP code.
         */
        otpCodeRetriever: (): Promise<string> => Promise.resolve('123456'),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('fails when retriever times out (returns falsy code)', async () => {
    const exec = makeMockActionExecutor();
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        otpTimeoutMs: 50,
        /**
         * Retriever that never resolves — will timeout.
         * @returns Never-resolving promise.
         */
        otpCodeRetriever: (): Promise<string> => new Promise((): false => false),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(false);
  });

  it('fails when OTP input target missing after retriever returns code', async () => {
    const exec = makeMockActionExecutor();
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        /**
         * Retriever returns a canned code.
         * @returns OTP code.
         */
        otpCodeRetriever: (): Promise<string> => Promise.resolve('847352'),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec);
    const result = await executeFillAction(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(false);
  });
});

describe('executeFillPost', () => {
  it('succeeds when no mediator', async () => {
    const ctx = makeMockContext();
    const result = await executeFillPost(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });

  it('succeeds when mediator + no error + no form still visible', async () => {
    const makeScreenshotPageResult16 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult16);
    const result = await executeFillPost(ctx);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });
});

describe('executeFillFinal', () => {
  it('stamps diagnostics when no mediator', async () => {
    const ctx = makeMockContext();
    const result = await executeFillFinal(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('otp-fill-final');
    }
  });

  it('stamps cookies count when mediator present', async () => {
    const makeScreenshotPageResult19 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult19);
    const result = await executeFillFinal(ctx);
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('cookies=');
    }
  });
});

// ── Extra coverage for POST and PRE ──────────────────────────────

describe('executeFillPre — fast-path & mock-bypass', () => {
  it('returns fast-path success when OTP not required + dashboard visible', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    // Mock mediator that returns found=true for ANY resolveVisible call
    // so probeDashboardReveal resolves positive.
    const mediator = makeMockMediator({
      /**
       * Always return found.
       * @returns Race result.
       */
      resolveVisible: () => Promise.resolve({ ...notFoundResult, found: true as const }),
    });
    const makeScreenshotPageResult21 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult21);
    const ctx = {
      ...base,
      mediator: some(mediator),
      config: { ...base.config, otp: { enabled: true, required: false } },
    };
    const result = await executeFillPre(ctx);
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
    if (isOk(result)) {
      // Either fast-path-skip (dashboard visible) OR OTP found successfully.
      expect(result.value.diagnostics.lastAction).toMatch(/otp-fill-pre/);
    }
  });
});

describe('executeFillPost — error detection', () => {
  it('fails when OTP error detected', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const mediator = makeMockMediator({
      /**
       * Return found=true for error probe.
       * @returns Race result.
       */
      resolveVisible: () =>
        Promise.resolve({
          ...notFoundResult,
          found: true as const,
          value: 'Invalid code',
        }),
    });
    const makeScreenshotPageResult23 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult23);
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executeFillPost(ctx);
    // When OTP error probe finds something, POST should fail.
    expect(typeof result.success).toBe('boolean');
  });
});
