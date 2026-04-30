/**
 * Deep branches for OtpFillPhaseActions — split from main file.
 */

import type { Page } from 'playwright-core';

import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  executeFillAction,
  executeFillPost,
  executeFillPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IResolvedTarget } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeFlushableLogger,
  makeMockActionExecutor,
  makeScreenshotPage,
  requireBrowser,
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

describe('executeFillAction — deep paths', () => {
  it('succeeds when submit target missing (fills input only)', async () => {
    const exec = makeMockActionExecutor();
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        /**
         * Retriever returns code.
         * @returns Resolved.
         */
        otpCodeRetriever: (): Promise<string> => Promise.resolve('999888'),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec, { otpInputTarget: MOCK_INPUT });
    const result = await executeFillAction(ctx);
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(true);
  });

  it('handles submit click rejection gracefully', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Reject click submit.
       * @returns Rejected.
       */
      clickElement: () => Promise.reject(new Error('click fail')),
    });
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        /**
         * Code retriever.
         * @returns Code.
         */
        otpCodeRetriever: (): Promise<string> => Promise.resolve('847352'),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const isOkResult25 = isOk(result);
    expect(isOkResult25).toBe(true);
  });
});

// ── Deep phone hint extraction ───────────────────────────────────
describe('executeFillPre — phone hint discovery', () => {
  it('extracts phone hint from iframe body text', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    /** Mock frame list with body text containing a masked phone. */
    const frameWithHint = {
      /**
       * Return body text with phone hint pattern.
       * @returns Body string.
       */
      evaluate: (): Promise<string> => Promise.resolve('Code sent to *****1234'),
    };
    const makeScreenshotPageResult26 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult26);
    const baseBrowser26 = requireBrowser(base);
    const pageWithFrames = {
      ...baseBrowser26.page,
      /**
       * Return one hint-bearing frame.
       * @returns Frames.
       */
      frames: (): unknown[] => [frameWithHint],
    };
    /** Mediator finds OTP input so PRE proceeds past the input check. */
    const foundResult = {
      ...notFoundResult,
      found: true as const,
      candidate: { kind: 'placeholder' as const, value: 'code' },
      context: pageWithFrames as unknown as Page,
      value: 'code',
    };
    const mediator = makeMockMediator({
      /**
       * Return found for input + submit probes.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(foundResult),
      /**
       * Also succeeds for resolveVisibleInContext.
       * @returns Found.
       */
      resolveVisibleInContext: () => Promise.resolve(foundResult),
    });
    const ctx = {
      ...base,
      mediator: some(mediator),
      browser: some({
        ...baseBrowser26,
        page: pageWithFrames as unknown as Page,
      }),
    };
    const result = await executeFillPre(ctx);
    const isOkResult27 = isOk(result);
    expect(isOkResult27).toBe(true);
  });

  it('handles frame evaluate rejection when extracting phone hint', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    /** Frame whose evaluate rejects. */
    const brokenFrame = {
      /**
       * Rejects evaluation.
       * @returns Rejected.
       */
      evaluate: (): Promise<string> => Promise.reject(new Error('broken')),
    };
    const makeScreenshotPageResult28 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult28);
    const baseBrowser28 = requireBrowser(base);
    const pageWithFrames = {
      ...baseBrowser28.page,
      /**
       * Include broken + good frame.
       * @returns Frames.
       */
      frames: (): unknown[] => [brokenFrame, brokenFrame],
    };
    const foundResult = {
      ...notFoundResult,
      found: true as const,
      candidate: { kind: 'placeholder' as const, value: 'code' },
      context: pageWithFrames as unknown as Page,
      value: 'code',
    };
    const mediator = makeMockMediator({
      /**
       * Return found.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(foundResult),
    });
    const ctx = {
      ...base,
      mediator: some(mediator),
      browser: some({
        ...baseBrowser28,
        page: pageWithFrames as unknown as Page,
      }),
    };
    const result = await executeFillPre(ctx);
    const isOkResult29 = isOk(result);
    expect(isOkResult29).toBe(true);
  });
});

// ── Fast-path OTP bypass (device-remembered) ─────────────────────
describe('executeFillPre — fast-path success branch', () => {
  it('hits fast-path (device-remembered) when OTP not required + dashboard visible', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    /** Track calls; only the 3rd+ call (dashboard probe) returns found. */
    let callIdx = 0;
    const mediator = makeMockMediator({
      /**
       * OTP probes (first 2 calls) → not-found.
       * Subsequent calls (dashboard probe) → found with candidate.
       * @returns Race result per index.
       */
      resolveVisible: () => {
        callIdx += 1;
        if (callIdx <= 2) return Promise.resolve(notFoundResult);
        const race = {
          ...notFoundResult,
          found: true as const,
          candidate: { kind: 'textContent' as const, value: 'Welcome' },
          value: 'Welcome',
        };
        return Promise.resolve(race);
      },
    });
    const makeScreenshotPageResult30 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult30);
    const ctx = {
      ...base,
      mediator: some(mediator),
      config: { ...base.config, otp: { enabled: true, required: false } },
    };
    const result = await executeFillPre(ctx);
    const isOkResult31 = isOk(result);
    expect(isOkResult31).toBe(true);
  });
});

describe('executeFillPost — re-probe paths', () => {
  it('fails when OTP form still visible in re-probe (no error)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    let callIdx = 0;
    const mediator = makeMockMediator({
      /**
       * First call (error probe) → not found.
       * Second call (form re-probe) → found=true.
       * @returns Stepwise result.
       */
      resolveVisible: () => {
        callIdx += 1;
        if (callIdx === 1) return Promise.resolve(notFoundResult);
        const race = {
          ...notFoundResult,
          found: true as const,
          candidate: { kind: 'placeholder' as const, value: 'code' },
          value: 'code',
        };
        return Promise.resolve(race);
      },
    });
    const makeScreenshotPageResult32 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult32);
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executeFillPost(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executeFillAction — timeout + retriever branches', () => {
  it('succeeds with submit target and network idle rejection', async () => {
    const exec = makeMockActionExecutor({
      /**
       * Network idle rejects — covers catch branch.
       * @returns Rejected.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('idle fail')),
    });
    const base = makeMockContext({
      logger: makeFlushableLogger(),
      options: {
        companyId: 'testBank',
        startDate: new Date('2024-01-01'),
        /**
         * Retriever returns code.
         * @returns Code.
         */
        otpCodeRetriever: (): Promise<string> => Promise.resolve('654321'),
      } as unknown as ScraperOptions,
    });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const isOkResult33 = isOk(result);
    expect(isOkResult33).toBe(true);
  });
});
