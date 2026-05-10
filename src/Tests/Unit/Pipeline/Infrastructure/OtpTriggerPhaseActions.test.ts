/**
 * Unit tests for OtpTriggerPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

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

  it('skips fail in MOCK_MODE even when trigger not detected', async () => {
    process.env.MOCK_MODE = '1';
    try {
      const page = makeScreenshotPage();
      const ctx = makeContextWithBrowser(page);
      const result = await executeTriggerPre(ctx);
      const isOkResult = isOk(result);
      expect(isOkResult).toBe(true);
    } finally {
      delete process.env.MOCK_MODE;
    }
  });

  it('hard-fails when OTP trigger not detected (non-mock mode)', async () => {
    // After the .withOtpTrigger() opt-in refactor, the trigger phase only
    // runs for banks that explicitly enabled it. A missing trigger element
    // therefore signals a real bank-UI break and must hard-fail (the prior
    // soft-skip-on-disabled-OTP path was a config gate, now removed).
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult3);
    const result = await executeTriggerPre(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
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

  it('stamps triggerScopeValidated=false when otpTriggerTarget is missing (M4)', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      expect(diag.triggerScopeValidated).toBe(false);
    }
  });

  it('stamps triggerScopeValidated=true when a post-click 2xx ACK was captured (M4)', async () => {
    const ackTimestamp = 1000;
    const triggerClickedAt = 500;
    const captures = [
      {
        url: 'https://login.bankhapoalim.example/sendOtp',
        method: 'POST',
        postData: '',
        responseBody: { ok: true },
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: ackTimestamp,
        status: 200,
      },
    ];
    const mediator = {
      network: {
        /**
         * Stub: returns the canned 2xx capture so the predicate fires.
         *
         * @returns Captures array.
         */
        getAllEndpoints: (): readonly unknown[] => captures,
      },
      /**
       * Stub: visibility re-probe (unused when ACK fires first).
       *
       * @returns Resolved race result.
       */
      resolveVisible: (): Promise<{ readonly found: false }> => Promise.resolve({ found: false }),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: { ...baseCtx.diagnostics, otpTriggerTarget: MOCK_TARGET, triggerClickedAt },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      expect(diag.triggerScopeValidated).toBe(true);
    }
  });

  it('stamps triggerScopeValidated=true when no ACK fired but target is gone (M4)', async () => {
    const mediator = {
      network: {
        /**
         * Stub: empty capture pool (no ACK).
         *
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly unknown[] => [],
      },
      /**
       * Stub: visibility re-probe returns NOT_FOUND so target-gone fires.
       *
       * @returns Resolved race result with found=false.
       */
      resolveVisible: (): Promise<{ readonly found: false }> => Promise.resolve({ found: false }),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        triggerClickedAt: 0,
      },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      expect(diag.triggerScopeValidated).toBe(true);
    }
  });

  it('skips captures with non-2xx status when validating ACK (M4 coverage)', async () => {
    // Cover the `status < HTTP_2XX_LO || > HTTP_2XX_HI` branch and
    // the `status === undefined` early-return branch in
    // `isPostClickAck` — neither yields a hit, so the validator
    // falls through to the visibility re-probe (which returns
    // visible here, so scopeValidated=false).
    const captures = [
      // Capture without status field — exercises the
      // `status === undefined` early-return branch.
      {
        url: 'https://login.bank.example/missing-status',
        method: 'POST',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 100,
      },
      // 5xx capture — exercises the `status > HTTP_2XX_HI` branch.
      {
        url: 'https://login.bank.example/server-error',
        method: 'POST',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 100,
        status: 500,
      },
      // 1xx capture — exercises the `status < HTTP_2XX_LO` branch.
      {
        url: 'https://login.bank.example/informational',
        method: 'POST',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 100,
        status: 100,
      },
      // Pre-click 2xx — exercises the `timestamp < sinceMs` early-return.
      {
        url: 'https://login.bank.example/pre-click-ok',
        method: 'POST',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 50,
        status: 200,
      },
    ];
    const mediator = {
      network: {
        /**
         * Returns the curated mixed-status capture pool.
         *
         * @returns Captures array.
         */
        getAllEndpoints: (): readonly unknown[] => captures,
      },
      /**
       * Stub: visibility re-probe returns FOUND so scopeValidated stays false.
       *
       * @returns Resolved race result with found=true.
       */
      resolveVisible: (): Promise<{ readonly found: true }> => Promise.resolve({ found: true }),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        triggerClickedAt: 100,
      },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      expect(diag.triggerScopeValidated).toBe(false);
    }
  });

  it('treats resolveVisible rejection as "target gone" (catch arrow) (M4 coverage)', async () => {
    // Cover the `.catch((): false => false)` branch in probeTriggerScope.
    const mediator = {
      network: {
        /**
         * Empty capture pool so visibility re-probe runs.
         *
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly unknown[] => [],
      },
      /**
       * Reject so the .catch arrow fires.
       *
       * @returns Rejected promise.
       */
      resolveVisible: (): Promise<never> => Promise.reject(new Error('frame detached')),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        triggerClickedAt: 0,
      },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      // Rejection treated as target-gone → scopeValidated=true.
      expect(diag.triggerScopeValidated).toBe(true);
    }
  });

  it('reads triggerClickedAt=0 when diagnostics value is non-numeric (M4 coverage)', async () => {
    // Cover the `typeof raw !== 'number'` early-return in
    // readTriggerClickedAt.
    const mediator = {
      network: {
        /**
         * Empty pool — no ACK candidates.
         *
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly unknown[] => [],
      },
      /**
       * Visibility probe returns FOUND so scopeValidated stays false.
       *
       * @returns Resolved race result with found=true.
       */
      resolveVisible: (): Promise<{ readonly found: true }> => Promise.resolve({ found: true }),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        // Deliberately wrong type — exercises the `typeof !== number` branch.
        triggerClickedAt: 'not a number' as unknown as number,
      },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('stamps triggerScopeValidated=false when no ACK fired and target is still visible (M4)', async () => {
    const mediator = {
      network: {
        /**
         * Stub: empty capture pool.
         *
         * @returns Empty array.
         */
        getAllEndpoints: (): readonly unknown[] => [],
      },
      /**
       * Stub: visibility re-probe returns FOUND so target is still on the page.
       *
       * @returns Resolved race result with found=true.
       */
      resolveVisible: (): Promise<{ readonly found: true }> => Promise.resolve({ found: true }),
    } as unknown as IElementMediator;
    const basePage = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(basePage);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        triggerClickedAt: 0,
      },
    };
    const result = await executeTriggerPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      const diag = result.value.diagnostics as unknown as {
        readonly triggerScopeValidated?: boolean;
      };
      expect(diag.triggerScopeValidated).toBe(false);
    }
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

  it('emits ctx.otpTrigger with empty defaults when no PRE/ACTION/POST stamps (M4)', async () => {
    const ctx = makeMockContext();
    const result = await executeTriggerFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.otpTrigger.has).toBe(true);
      if (result.value.otpTrigger.has) {
        const snap = result.value.otpTrigger.value;
        expect(snap.phoneHint).toBe('');
        expect(snap.triggered).toBe(false);
        expect(snap.scopeValidated).toBe(false);
      }
    }
  });

  it('emits ctx.otpTrigger reflecting PRE/POST stamps (M4)', async () => {
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      diagnostics: {
        ...baseCtx.diagnostics,
        otpTriggerTarget: MOCK_TARGET,
        otpPhoneHint: '1234',
        triggerScopeValidated: true,
      },
    };
    const result = await executeTriggerFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.otpTrigger.has).toBe(true);
      if (result.value.otpTrigger.has) {
        const snap = result.value.otpTrigger.value;
        expect(snap.phoneHint).toBe('1234');
        expect(snap.triggered).toBe(true);
        expect(snap.scopeValidated).toBe(true);
      }
    }
  });

  it('falls back to defaults when diagnostics carry wrong-typed values (M4 coverage)', async () => {
    // Cover the `typeof !== boolean` and `typeof !== string` early-
    // return branches in readScopeValidated and readPhoneHint.
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      diagnostics: {
        ...baseCtx.diagnostics,
        otpPhoneHint: 1234 as unknown as string,
        triggerScopeValidated: 'yes' as unknown as boolean,
      },
    };
    const result = await executeTriggerFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.otpTrigger.has).toBe(true);
      if (result.value.otpTrigger.has) {
        const snap = result.value.otpTrigger.value;
        expect(snap.phoneHint).toBe('');
        expect(snap.scopeValidated).toBe(false);
      }
    }
  });
});

// ── Phone-hint extraction branches (PRE) ────────────────────────────
describe('executeTriggerPre — phone hint extraction', () => {
  it('extracts phone hint from body text (covered before missing-trigger fail)', async () => {
    // The phone-hint extractor runs BEFORE the missing-trigger check.
    // With no trigger detected, the action hard-fails (post-refactor),
    // but the phone-hint extraction code path still executes for coverage.
    const pageWithHint = makeScreenshotPage('Code sent to *****4321');
    const ctx = makeContextWithBrowser(pageWithHint);
    const result = await executeTriggerPre(ctx);
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(false);
  });

  it('handles rejected page.evaluate gracefully (covered before missing-trigger fail)', async () => {
    const page = makeScreenshotPage();
    const rejectingPage = {
      ...page,
      /**
       * Reject body text read.
       * @returns Rejected.
       */
      evaluate: (): Promise<string> => Promise.reject(new Error('eval fail')),
    };
    const ctx = makeContextWithBrowser(rejectingPage);
    const result = await executeTriggerPre(ctx);
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(false);
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
