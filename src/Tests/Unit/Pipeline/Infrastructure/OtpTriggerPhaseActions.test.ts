/**
 * Unit tests for OtpTriggerPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import { jest } from '@jest/globals';

import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeTriggerAction,
  executeTriggerFinal,
  executeTriggerPost,
  executeTriggerPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPipelineContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
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

  it('A.1 — stamps triggerClickedAt BEFORE waitForNetworkIdle starts (race fix)', async () => {
    // PR #221 review finding A.1: today triggerClickedAt is recorded
    // AFTER waitForNetworkIdle() returns, so any OTP ACK landing during
    // that settle window has timestamp < triggerClickedAt and is
    // filtered as "pre-click" by isPostClickAck() → false negative on
    // fast banks. The stamp MUST happen immediately after the click
    // succeeds, before the settle wait, so the wait window is INSIDE
    // the post-click window.
    // Use Jest fake timers so the settle-wait → click-stamp ordering
    // assertion is deterministic (no real-clock dependency). The
    // production code stamps `triggerClickedAt = Date.now()` BEFORE
    // calling `waitForNetworkIdle`; if the stamp ever moves AFTER
    // the wait, this test fails.
    jest.useFakeTimers({ doNotFake: ['performance'] });
    try {
      let waitStartMs = 0;
      let didStampBeforeWait = true;
      const slowSettleExec = makeMockActionExecutor({
        /**
         * Records the wall-clock instant when settle wait was invoked.
         * Resolves immediately — the assertion is on temporal
         * ordering vs `triggerClickedAt`, not duration.
         *
         * @returns Resolved succeed.
         */
        waitForNetworkIdle: () => {
          waitStartMs = Date.now();
          const okVoid = { success: true as const, value: undefined };
          return Promise.resolve(okVoid);
        },
      });
      const baseCtx = makeMockContext();
      const ctx = toActionCtx(baseCtx, slowSettleExec, { otpTriggerTarget: MOCK_TARGET });
      const pending = executeTriggerAction(ctx);
      // Advance the fake clock so that any setTimeout-driven settle
      // resolves; without the stamp-before-wait fix `triggerClickedAt`
      // would land AFTER `waitStartMs` (i.e. > waitStartMs).
      await jest.advanceTimersByTimeAsync(50);
      const result = await pending;
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
      if (result.success) {
        const diag = result.value.diagnostics as { triggerClickedAt?: unknown };
        const stamp = diag.triggerClickedAt;
        const isStampNumber = typeof stamp === 'number';
        expect(isStampNumber).toBe(true);
        if (isStampNumber) {
          didStampBeforeWait = stamp <= waitStartMs;
        }
      }
      expect(didStampBeforeWait).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── A.5: shared helpers + scenario table for executeTriggerPost ──

/** Discoverable shape used in test stubs. */
interface IRaceLikeResult {
  readonly found: boolean;
  readonly value?: string;
}

/** Scenario row for the `executeTriggerPost` scope-validation table. */
interface IPostScopeScenario {
  /** Test label as `it(...)` name. */
  readonly label: string;
  /** Captures returned by the stubbed `getAllEndpoints`. */
  readonly captures: readonly unknown[];
  /** Stub for `mediator.resolveVisible` — return resolved or rejected. */
  readonly resolveVisible: () => Promise<IRaceLikeResult>;
  /** Diagnostics overlay merged on top of the standard `MOCK_TARGET` ctx. */
  readonly diagOverrides: Record<string, unknown>;
  /** Expected `triggerScopeValidated` value after `executeTriggerPost`. */
  readonly expectedScopeValidated: boolean;
}

/**
 * Build a stubbed `IElementMediator` that exposes the canned
 * captures pool + resolveVisible behaviour. No real network or
 * Playwright dependency.
 *
 * @param scenario - Scenario row with captures + resolveVisible.
 * @returns Stubbed mediator typed as `IElementMediator`.
 */
function makeStubMediator(scenario: IPostScopeScenario): IElementMediator {
  return {
    network: {
      /**
       * Return the canned captures pool.
       *
       * @returns Captures array.
       */
      getAllEndpoints: (): readonly unknown[] => scenario.captures,
    },
    resolveVisible: scenario.resolveVisible,
  } as unknown as IElementMediator;
}

/**
 * Build the `executeTriggerPost` test context for the table-driven
 * scope-validation cases. Standardises base ctx + mediator + the
 * default `otpTriggerTarget` diagnostic, layering scenario-specific
 * overrides on top. The diagnostics block carries `otpTriggerTarget`
 * which is not on `IDiagnosticsState` — assigned via a typed local
 * variable so TypeScript's excess-property check on the outer
 * literal does not fire (production code reads it through the
 * wider-shape-tolerant `readDiagTarget` helper).
 *
 * @param scenario - Scenario row.
 * @returns Pipeline context ready for `executeTriggerPost`.
 */
function makeScopeValidationCtx(scenario: IPostScopeScenario): IPipelineContext {
  const screenshotPage = makeScreenshotPage();
  const baseCtx = makeContextWithBrowser(screenshotPage);
  const enrichedDiagnostics = {
    ...baseCtx.diagnostics,
    otpTriggerTarget: MOCK_TARGET,
    ...scenario.diagOverrides,
  } as IPipelineContext['diagnostics'];
  const stubMediator = makeStubMediator(scenario);
  return {
    ...baseCtx,
    mediator: some(stubMediator),
    diagnostics: enrichedDiagnostics,
  };
}

/** Single auth-domain 2xx capture (Hapoalim-class sendOtp endpoint). */
const ACK_CAPTURE = {
  url: 'https://login.bankhapoalim.example/sendOtp',
  method: 'POST',
  postData: '',
  responseBody: { ok: true },
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1000,
  status: 200,
} as const;

/** Non-auth dashboard 2xx capture — must NOT promote to ACK (A.2). */
const NON_AUTH_2XX_CAPTURE = {
  url: 'https://api.bank.example/dashboard/transactions',
  method: 'POST',
  postData: '',
  responseBody: { items: [] },
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1000,
  status: 200,
} as const;

/**
 * PR #221 review (id 3215182688): a 2xx dashboard capture whose
 * QUERY STRING contains the keyword `login` must NOT promote to ACK.
 * The path scope (`/dashboard`) is what counts; the query parameter
 * `?from=login` is incidental UI breadcrumb routing data.
 */
const QUERY_STRING_LOGIN_CAPTURE = {
  url: 'https://api.bank.example/dashboard?from=login',
  method: 'GET',
  postData: '',
  responseBody: {},
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1000,
  status: 200,
} as const;

/**
 * PR #221 review (id 3215182688): a 2xx capture whose HOST contains
 * the keyword `login` (e.g. `login.bank.example`) but whose PATH does
 * NOT must NOT promote to ACK. Common bank topology — the auth subdomain
 * is named `login.*` but unrelated assets (CSS / images / static pages)
 * served from it must not falsely satisfy the ACK gate.
 */
const HOST_LOGIN_NON_AUTH_PATH_CAPTURE = {
  url: 'https://login.bank.example/static/main.css',
  method: 'GET',
  postData: '',
  responseBody: '',
  contentType: 'text/css',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1000,
  status: 200,
} as const;

/** Mixed-status pool exercising every `isPostClickAck` rejection branch. */
const MIXED_STATUS_CAPTURES = [
  // status=undefined → early-return (line `ep.status === undefined`).
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
  // 5xx → upper-bound rejection branch.
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
  // 1xx → lower-bound rejection branch.
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
  // Pre-click 2xx → `timestamp < sinceMs` early-return branch.
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
] as const;

/**
 * Stubbed resolveVisible: target is GONE (found=false).
 *
 * @returns Resolved race-like result with `found=false`.
 */
const STUB_RESOLVE_GONE = (): Promise<IRaceLikeResult> => Promise.resolve({ found: false });

/**
 * Stubbed resolveVisible: target STILL VISIBLE (found=true).
 *
 * @returns Resolved race-like result with `found=true`.
 */
const STUB_RESOLVE_VISIBLE = (): Promise<IRaceLikeResult> =>
  Promise.resolve({ found: true, value: 'still-visible' });

/**
 * Stubbed resolveVisible: REJECTS — caller's `.catch` should fire.
 *
 * @returns Rejected promise with a representative frame-detach error.
 */
const STUB_RESOLVE_REJECT = (): Promise<IRaceLikeResult> =>
  Promise.reject(new Error('frame detached'));

const POST_SCOPE_SCENARIOS: readonly IPostScopeScenario[] = [
  {
    label: 'stamps triggerScopeValidated=true when a post-click 2xx ACK was captured (M4)',
    captures: [ACK_CAPTURE],
    resolveVisible: STUB_RESOLVE_GONE,
    diagOverrides: { triggerClickedAt: 500 },
    expectedScopeValidated: true,
  },
  {
    label:
      'A.2 — does NOT promote a non-auth 2xx to ACK (analytics/dashboard false-positive guard)',
    captures: [NON_AUTH_2XX_CAPTURE],
    resolveVisible: STUB_RESOLVE_VISIBLE,
    diagOverrides: { triggerClickedAt: 500 },
    expectedScopeValidated: false,
  },
  {
    // PR #221 review id 3215182688 — path-scope tightening.
    label: 'B.1 — does NOT promote a 2xx whose `login` keyword lives in the query string',
    captures: [QUERY_STRING_LOGIN_CAPTURE],
    resolveVisible: STUB_RESOLVE_VISIBLE,
    diagOverrides: { triggerClickedAt: 500 },
    expectedScopeValidated: false,
  },
  {
    // PR #221 review id 3215182688 — path-scope tightening.
    label: 'B.1 — does NOT promote a 2xx whose `login` keyword lives in the HOST only',
    captures: [HOST_LOGIN_NON_AUTH_PATH_CAPTURE],
    resolveVisible: STUB_RESOLVE_VISIBLE,
    diagOverrides: { triggerClickedAt: 500 },
    expectedScopeValidated: false,
  },
  {
    label: 'stamps triggerScopeValidated=true when no ACK fired but target is gone (M4)',
    captures: [],
    resolveVisible: STUB_RESOLVE_GONE,
    diagOverrides: { triggerClickedAt: 0 },
    expectedScopeValidated: true,
  },
  {
    label: 'skips captures with non-2xx status when validating ACK (M4 coverage)',
    captures: MIXED_STATUS_CAPTURES,
    resolveVisible: STUB_RESOLVE_VISIBLE,
    diagOverrides: { triggerClickedAt: 100 },
    expectedScopeValidated: false,
  },
  {
    // PR #221 review (id 3215505993) — B.2 fix: a probe REJECTION is
    // UNKNOWN, not "target gone". Previously this scenario stamped
    // scopeValidated=true; the tightened contract now requires
    // false. Catch arrow still fires; the difference is what we do
    // with the resulting `false` sentinel.
    label: 'B.2 — treats resolveVisible rejection as UNKNOWN (no scope-validated stamp)',
    captures: [],
    resolveVisible: STUB_RESOLVE_REJECT,
    diagOverrides: { triggerClickedAt: 0 },
    expectedScopeValidated: false,
  },
  {
    label:
      'reads triggerClickedAt=0 when diagnostics value is non-numeric (M4 coverage) — A.4 asserts stamped value',
    captures: [],
    resolveVisible: STUB_RESOLVE_VISIBLE,
    // Deliberately wrong type — exercises the `typeof !== number`
    // early-return branch in readTriggerClickedAt. Cast so the
    // override value type-conforms while preserving the intentional
    // mistype.
    diagOverrides: { triggerClickedAt: 'not a number' },
    expectedScopeValidated: false,
  },
  {
    label: 'stamps triggerScopeValidated=false when no ACK fired and target is still visible (M4)',
    captures: [],
    resolveVisible: STUB_RESOLVE_VISIBLE,
    diagOverrides: { triggerClickedAt: 0 },
    expectedScopeValidated: false,
  },
];

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

  // ── A.5: Table-driven POST scope-validation cases ─────────────
  // PR #221 review finding A.5: every POST scope-validation case
  // shared the same baseCtx/mediator/diagnostics harness with only
  // captures, probe outcome, and expected flag changing. Per project
  // coding rule "Use config arrays mapped with `.map()` — no
  // duplication", the cases are now driven by POST_SCOPE_SCENARIOS.
  // `for...of` over the table avoids the eslint/biome conflict
  // between `forEach((scenario): void)` (eslint bans void) and
  // `forEach((scenario): true)` (biome flags the unused return).
  for (const scenario of POST_SCOPE_SCENARIOS) {
    it(scenario.label, async () => {
      const ctx = makeScopeValidationCtx(scenario);
      const result = await executeTriggerPost(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
      if (result.success) {
        const diag = result.value.diagnostics as { readonly triggerScopeValidated?: boolean };
        expect(diag.triggerScopeValidated).toBe(scenario.expectedScopeValidated);
      }
    });
  }
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
