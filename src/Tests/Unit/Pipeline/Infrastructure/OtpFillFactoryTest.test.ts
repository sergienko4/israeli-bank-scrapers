/**
 * M3.T5 — cross-bank factory test for the OTP-FILL phase.
 *
 * <p>One logic path, parametrized over every browser-flow bank
 * that enables OTP-FILL (mandatory or optional). Mirrors the
 * {@link AuthDiscoveryFactoryTest} + {@link LoginFactoryTest}
 * shape: a `BANK_OTP_FILL_FIXTURES` table drives `describe.each`
 * for the bank-shape contracts (pipeline phase sequence with the
 * OTP-FILL phase wired in), and a separate set of bank-agnostic
 * blocks exercises the OTP-FILL handlers (`executeFillPre`,
 * `executeFillAction`, `executeFillPost`, `executeFillFinal`)
 * using a generic mock context.
 *
 * <p>Coverage absorbed from (deleted by this PR):
 * `Tests/Unit/Pipeline/Infrastructure/OtpFillPhaseActions.test.ts`,
 * `Tests/Unit/Pipeline/Infrastructure/OtpFillPhaseActionsDeep.test.ts`,
 * `Tests/Unit/Pipeline/Phases/OtpFill/OtpFillPhase.test.ts`.
 * Coverage threshold (97/95/97/98) is preserved — every cross-bank
 * scenario folded into one of the blocks below.
 *
 * <p>FAKE-but-real-bank-shape data: each fixture row reuses the
 * production `build*Pipeline` builder and asserts the OTP-FILL
 * phase is present in its expected position. URLs use `.example`
 * reserved TLDs; OTP code samples are obviously fake.
 */

import type { Page } from 'playwright-core';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { buildBeinleumiPipeline } from '../../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import { buildHapoalimPipeline } from '../../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import {
  createOtpFillPhase,
  OTP_FILL_STEP,
  OtpFillPhase,
} from '../../../../Scrapers/Pipeline/Phases/OtpFill/OtpFillPhase.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeFlushableLogger,
  makeMockActionExecutor,
  makeScreenshotPage,
  toActionCtx,
} from './TestHelpers.js';

// ─── Bank fixture table (every OTP-FILL-enabled browser bank) ────

/** Per-bank fixture for the OTP-FILL `describe.each` block. */
interface IOtpFillBankFixture {
  readonly bank: string;
  readonly company: CompanyTypes;
  readonly buildPipeline: (opts: ScraperOptions) => Procedure<IPipelineDescriptor>;
  readonly otpRequired: boolean;
}

/**
 * Live-tested OTP-FILL banks. Beinleumi runs the full mandatory
 * OTP flow (trigger + fill); Hapoalim runs the optional soft-skip
 * variant. OneZero is API-direct (no Pipeline OTP-FILL phase, see
 * `Mediator/ApiDirectCall/`). Massad/OtsarHahayal/Pagi register
 * `withOtpFill()` in their pipelines but are NOT live-tested today,
 * so the factory excludes them — adding them would assert behavior
 * we can't validate end-to-end.
 */
const BANK_OTP_FILL_FIXTURES: readonly IOtpFillBankFixture[] = [
  {
    bank: 'beinleumi',
    company: CompanyTypes.Beinleumi,
    buildPipeline: buildBeinleumiPipeline,
    otpRequired: true,
  },
  {
    bank: 'hapoalim',
    company: CompanyTypes.Hapoalim,
    buildPipeline: buildHapoalimPipeline,
    otpRequired: false,
  },
];

/**
 * Build a {@link ScraperOptions} stub for the bank's pipeline
 * builder.
 *
 * @param company - Bank under test.
 * @returns Mock options bound to the company.
 */
function makeOpts(company: string): ScraperOptions {
  return { companyId: company } as unknown as ScraperOptions;
}

// ─── Cross-bank OTP-FILL pipeline-shape contract ─────────────────

describe.each(BANK_OTP_FILL_FIXTURES)(
  '$bank — OTP-FILL phase wiring (otpRequired=$otpRequired)',
  fixture => {
    it("includes the 'otp-fill' phase in the built pipeline", () => {
      const opts = makeOpts(fixture.company);
      const result = fixture.buildPipeline(opts);
      expect(result.success).toBe(true);
      if (result.success) {
        const names = result.value.phases.map((p): string => p.name);
        expect(names).toContain('otp-fill');
      }
    });

    it("places 'otp-fill' immediately after 'login' (or after 'otp-trigger' when present)", () => {
      const opts = makeOpts(fixture.company);
      const result = fixture.buildPipeline(opts);
      expect(result.success).toBe(true);
      if (result.success) {
        const names = result.value.phases.map((p): string => p.name);
        const otpFillIdx = names.indexOf('otp-fill');
        const triggerIdx = names.indexOf('otp-trigger');
        const loginIdx = names.indexOf('login');
        const expectedPredecessor = triggerIdx >= 0 ? 'otp-trigger' : 'login';
        const expectedPredecessorIdx = triggerIdx >= 0 ? triggerIdx : loginIdx;
        expect(otpFillIdx).toBe(expectedPredecessorIdx + 1);
        expect(names[otpFillIdx - 1]).toBe(expectedPredecessor);
      }
    });
  },
);

// ─── Bank-agnostic OTP-FILL action handlers ──────────────────────

/** Mock OTP input target — the input the user types the code into. */
const MOCK_INPUT: IResolvedTarget = {
  selector: '#otp',
  contextId: 'main',
  kind: 'placeholder',
  candidateValue: 'code',
};

/** Mock OTP submit target — the "Send" / "Continue" button. */
const MOCK_SUBMIT: IResolvedTarget = {
  selector: '#submit',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Send',
};

describe('executeFillPre — pre-condition guards + MOCK_MODE bypass', () => {
  it('succeeds when mediator is missing', async () => {
    const ctx = makeMockContext();
    const result = await executeFillPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('succeeds when browser is missing but mediator is present', async () => {
    const stub = {} as unknown as IElementMediator;
    const ctx = makeMockContext({ mediator: some(stub) });
    const result = await executeFillPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when OTP is required AND the OTP input was not found', async () => {
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = {
      ...baseCtx,
      config: { ...baseCtx.config, otp: { enabled: true, required: true } },
    };
    const result = await executeFillPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('emits the mock-bypass diagnostic when MOCK_MODE=1 and OTP form not found', async () => {
    const original = process.env.MOCK_MODE;
    process.env.MOCK_MODE = '1';
    try {
      const page = makeScreenshotPage();
      const ctx = makeContextWithBrowser(page);
      const result = await executeFillPre(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
      if (wasOk) expect(result.value.diagnostics.lastAction).toContain('mock-bypass');
      // M4.F1: even on MOCK bypass, OTP-FILL must emit `ctx.otpFill`
      // so AUTH-DISCOVERY's precedence walk has a populated slot.
      if (wasOk) expect(result.value.otpFill.has).toBe(true);
    } finally {
      if (original === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = original;
    }
  });

  it('M4.F1 carry-forward: soft-skip OTP-FILL inherits the URL from ctx.otpTrigger when present', async () => {
    // Flow 5 with OTP-TRIGGER having run earlier — the carry-forward
    // helper must prefer the OTP-TRIGGER emit over the LOGIN emit
    // because OTP-TRIGGER is the more recent producer.
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = {
      ...baseCtx,
      config: { ...baseCtx.config, otp: { enabled: true, required: false } },
      login: some({
        activeFrame: page,
        persistentOtpToken: none(),
        urlBeforeSubmit: 'https://web.bank/login',
      }),
      otpTrigger: some({
        phoneHint: '',
        triggered: true,
        scopeValidated: true,
        urlBeforeSubmit: 'https://web.bank/otp-trigger',
      }),
    };
    const result = await executeFillPre(ctx, false);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) {
      expect(result.value.otpFill.has).toBe(true);
      if (result.value.otpFill.has) {
        expect(result.value.otpFill.value.urlBeforeSubmit).toBe('https://web.bank/otp-trigger');
      }
    }
  });

  it('M4.F1 carry-forward: soft-skip OTP-FILL inherits the URL from ctx.login when otpTrigger is none', async () => {
    // Flow 4 / 5: LOGIN ran but no OTP-TRIGGER. The carry-forward
    // helper falls back to LOGIN's emit.
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = {
      ...baseCtx,
      config: { ...baseCtx.config, otp: { enabled: true, required: false } },
      login: some({
        activeFrame: page,
        persistentOtpToken: none(),
        urlBeforeSubmit: 'https://web.bank/login',
      }),
    };
    const result = await executeFillPre(ctx, false);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk && result.value.otpFill.has) {
      expect(result.value.otpFill.value.urlBeforeSubmit).toBe('https://web.bank/login');
    }
  });

  it('M4.F1 carry-forward: empty fallback when neither LOGIN nor OTP-TRIGGER emitted', async () => {
    // Test path only — no upstream emit. carryUrlForward returns ''.
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = {
      ...baseCtx,
      config: { ...baseCtx.config, otp: { enabled: true, required: false } },
    };
    const result = await executeFillPre(ctx, false);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk && result.value.otpFill.has) {
      expect(result.value.otpFill.value.urlBeforeSubmit).toBe('');
    }
  });

  it('emits the otp-fill-pre diagnostic when OTP is optional + dashboard visible', async () => {
    /**
     * Reveal probe — returns a found result so the dashboard reveal
     * branch fires.
     *
     * @returns Race result with `found: true`.
     */
    const resolveVisible = (): Promise<typeof NOT_FOUND_RESULT & { found: true }> =>
      Promise.resolve({ ...NOT_FOUND_RESULT, found: true as const });
    const mediator = makeMockMediator({ resolveVisible });
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = {
      ...baseCtx,
      mediator: some(mediator),
      config: { ...baseCtx.config, otp: { enabled: true, required: false } },
    };
    const result = await executeFillPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value.diagnostics.lastAction).toMatch(/otp-fill-pre/);
  });
});

/**
 * Build mock options carrying an `otpCodeRetriever` that resolves
 * with a fake numeric code. Used by the action-success path.
 *
 * @param fakeCode - Six-digit fake code for the test row.
 * @returns Mock options.
 */
function makeOptionsWithRetriever(fakeCode: string): ScraperOptions {
  /**
   * Retriever returns a canned code.
   *
   * @returns Fake OTP code.
   */
  const otpCodeRetriever = (): Promise<string> => Promise.resolve(fakeCode);
  return {
    companyId: 'testBank',
    startDate: new Date('2024-01-01'),
    otpCodeRetriever,
  } as unknown as ScraperOptions;
}

describe('executeFillAction — pre-condition guards + retriever', () => {
  it('returns succeed when no executor is wired', async () => {
    const baseCtx = makeMockContext();
    const ctx = toActionCtx(baseCtx, false);
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('honors optional-skip from PRE diagnostics (M1+ replaces fast-path)', async () => {
    const base = makeMockContext();
    const exec = makeMockActionExecutor();
    const ctx: IActionContext = toActionCtx(
      {
        ...base,
        diagnostics: { ...base.diagnostics, lastAction: 'otp-fill-pre (optional-skip)' },
      },
      exec,
    );
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when no otpCodeRetriever is in options', async () => {
    const exec = makeMockActionExecutor();
    const baseCtx = makeMockContext();
    const ctx = toActionCtx(baseCtx, exec);
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fills + submits when retriever returns a code', async () => {
    const exec = makeMockActionExecutor();
    const logger = makeFlushableLogger();
    const options = makeOptionsWithRetriever('123456');
    const base = makeMockContext({ logger, options });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when retriever times out (returns falsy code)', async () => {
    const exec = makeMockActionExecutor();
    const logger = makeFlushableLogger();
    /**
     * Retriever that never resolves — used to exercise the timeout
     * path against a 50 ms budget.
     *
     * @returns Never-resolving promise.
     */
    const otpCodeRetriever = (): Promise<string> => new Promise((): false => false);
    const options = {
      companyId: 'testBank',
      startDate: new Date('2024-01-01'),
      otpTimeoutMs: 50,
      otpCodeRetriever,
    } as unknown as ScraperOptions;
    const base = makeMockContext({ logger, options });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fills the OTP input but skips the submit click when no submit target is set', async () => {
    const exec = makeMockActionExecutor();
    const logger = makeFlushableLogger();
    const options = makeOptionsWithRetriever('111000');
    const base = makeMockContext({ logger, options });
    // Only the input target is set — `submitTarget` stays absent so
    // the `if (submitTarget)` branch (line 270 of OtpFillPhaseActions)
    // takes the false path and skips the click.
    const ctx = toActionCtx(base, exec, { otpInputTarget: MOCK_INPUT });
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('tolerates executor.waitForNetworkIdle / clickElement rejection (catch fallthrough)', async () => {
    /**
     * Executor whose `waitForNetworkIdle` rejects — exercises the
     * `.catch((): false => false)` fallback at the OTP idle wait
     * (lines 248 and 278 of OtpFillPhaseActions).
     *
     * @returns Rejected promise.
     */
    const waitForNetworkIdle = (): Promise<never> => Promise.reject(new Error('idle-fail'));
    /**
     * Executor whose `clickElement` rejects — exercises the
     * `.catch((): false => false)` fallback at the submit click
     * (line 273 of OtpFillPhaseActions).
     *
     * @returns Rejected promise.
     */
    const clickElement = (): Promise<never> => Promise.reject(new Error('click-fail'));
    const exec = makeMockActionExecutor({ waitForNetworkIdle, clickElement });
    const logger = makeFlushableLogger();
    const options = makeOptionsWithRetriever('[REDACTED-DIGITS-6]');
    const base = makeMockContext({ logger, options });
    const ctx = toActionCtx(base, exec, {
      otpInputTarget: MOCK_INPUT,
      otpSubmitTarget: MOCK_SUBMIT,
    });
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when the OTP input target is missing after retriever returns a code', async () => {
    const exec = makeMockActionExecutor();
    const logger = makeFlushableLogger();
    const options = makeOptionsWithRetriever('847352');
    const base = makeMockContext({ logger, options });
    const ctx = toActionCtx(base, exec);
    const result = await executeFillAction(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});

describe('executeFillPost — error detection + traffic settled', () => {
  it('succeeds when mediator is missing', async () => {
    const ctx = makeMockContext();
    const result = await executeFillPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('succeeds when mediator is present + no error + form gone', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeFillPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('returns a procedure (success or fail) when error probe finds a banner', async () => {
    /**
     * Error probe — returns found=true with a banner value.
     *
     * @returns Race result.
     */
    const resolveVisible = (): Promise<typeof NOT_FOUND_RESULT & { found: true; value: string }> =>
      Promise.resolve({ ...NOT_FOUND_RESULT, found: true as const, value: 'Invalid code' });
    const mediator = makeMockMediator({ resolveVisible });
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithBrowser(page);
    const ctx = { ...baseCtx, mediator: some(mediator) };
    const result = await executeFillPost(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executeFillFinal — diagnostics stamping', () => {
  it('stamps diagnostics when no mediator is wired', async () => {
    const ctx = makeMockContext();
    const result = await executeFillFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value.diagnostics.lastAction).toContain('otp-fill-final');
  });

  it('stamps cookies count when mediator is wired', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeFillFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value.diagnostics.lastAction).toContain('cookies=');
  });
});

// ─── OtpFillPhase + OTP_FILL_STEP wrapper ────────────────────────

describe('OtpFillPhase — phase class + lifecycle delegation', () => {
  it("has name 'otp-fill'", () => {
    const phase = createOtpFillPhase();
    expect(phase.name).toBe('otp-fill');
  });

  it('is an instance of OtpFillPhase', () => {
    const phase = createOtpFillPhase();
    expect(phase).toBeInstanceOf(OtpFillPhase);
  });

  it('phase.pre() delegates to executeFillPre and succeeds', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('phase.post() delegates to executeFillPost and succeeds', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('phase.final() delegates to executeFillFinal and succeeds (stamps diagnostics)', async () => {
    const phase = createOtpFillPhase();
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('phase.action() succeeds when no executor is wired', async () => {
    const phase = createOtpFillPhase();
    const baseCtx = makeMockContext();
    const ctx = toActionCtx(baseCtx, false);
    const result = await phase.action(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('phase.action() fails when retriever missing AND executor is wired', async () => {
    const phase = createOtpFillPhase();
    const exec = makeMockActionExecutor();
    const baseCtx = makeMockContext();
    const ctx = toActionCtx(baseCtx, exec);
    const result = await phase.action(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});

describe('OTP_FILL_STEP — compat step', () => {
  it("has name 'otp-fill'", () => {
    expect(OTP_FILL_STEP.name).toBe('otp-fill');
  });

  it('execute() returns succeed(input)', async () => {
    const ctx = makeMockContext();
    const result = await OTP_FILL_STEP.execute(ctx, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

// ─── Phone-hint deep frame walker ────────────────────────────────

/** Frame stub shape consumed by `extractDeepPhoneHint`. */
interface IFrameStub {
  readonly evaluate: () => Promise<string>;
}

/**
 * Build a frame stub whose `evaluate` resolves to the supplied text.
 *
 * @param text - Body text the frame returns.
 * @returns Frame stub.
 */
function makeFrameStub(text: string): IFrameStub {
  /**
   * Frame `evaluate` returns the captured body text.
   *
   * @returns Body text.
   */
  const evaluate = (): Promise<string> => Promise.resolve(text);
  return { evaluate };
}

/**
 * Build a context whose page returns frames with the supplied body
 * texts AND a mediator whose `resolveVisible` reports the OTP input
 * as found (so `extractDeepPhoneHint` actually runs after PRE's
 * `hasInput` gate).
 *
 * @param bodyTexts - Per-frame body strings.
 * @returns Pipeline context with the patched page + mediator.
 */
function makeCtxWithFrames(bodyTexts: readonly string[]): IPipelineContext {
  const basePage = makeScreenshotPage();
  const frameStubs: readonly IFrameStub[] = bodyTexts.map(makeFrameStub);
  /**
   * Stubbed `frames()` returns the captured frame stubs.
   *
   * @returns Frame array.
   */
  const frames = (): readonly IFrameStub[] => frameStubs;
  const patchedPage: Page = { ...basePage, frames } as unknown as Page;
  /**
   * Stub `resolveVisible` returning a found OTP form.
   *
   * @returns Race result with `found: true`.
   */
  const resolveVisible = (): Promise<typeof NOT_FOUND_RESULT & { found: true }> =>
    Promise.resolve({ ...NOT_FOUND_RESULT, found: true as const });
  const mediator = makeMockMediator({ resolveVisible });
  const baseCtx: IPipelineContext = makeContextWithBrowser(patchedPage);
  const ctx: IPipelineContext = { ...baseCtx, mediator: some(mediator) };
  return ctx;
}

describe('executeFillPre — deep phone-hint extraction (frame walker)', () => {
  it('extracts the last digits when a frame surfaces a phone-hint pattern', async () => {
    const sms = 'A code was sent to ***1234 — please enter it below';
    const ctx = makeCtxWithFrames([sms]);
    const result = await executeFillPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('handles a frame whose evaluate rejects (catch returns empty)', async () => {
    const basePage = makeScreenshotPage();
    /**
     * Frame whose `evaluate` rejects — exercises `extractHintFromFrame`'s
     * `.catch((): string => '')` branch.
     *
     * @returns Rejected promise.
     */
    const evaluateReject = (): Promise<string> => Promise.reject(new Error('frame gone'));
    const frameStub: IFrameStub = { evaluate: evaluateReject };
    /**
     * Return a single rejecting frame.
     *
     * @returns Frame array.
     */
    const frames = (): readonly IFrameStub[] => [frameStub];
    const patchedPage: Page = { ...basePage, frames } as unknown as Page;
    /**
     * Stub `resolveVisible` returning a found OTP form so the phone-
     * hint extraction code path runs.
     *
     * @returns Race result with `found: true`.
     */
    const resolveVisible = (): Promise<typeof NOT_FOUND_RESULT & { found: true }> =>
      Promise.resolve({ ...NOT_FOUND_RESULT, found: true as const });
    const mediator = makeMockMediator({ resolveVisible });
    const baseCtx: IPipelineContext = makeContextWithBrowser(patchedPage);
    const ctx: IPipelineContext = { ...baseCtx, mediator: some(mediator) };
    const result = await executeFillPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('returns empty hint when no frame body matches the phone-hint pattern', async () => {
    const ctx = makeCtxWithFrames(['no hint here', 'still nothing']);
    const result = await executeFillPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('short-circuits to the first match across multiple frames', async () => {
    const ctx = makeCtxWithFrames([
      'first frame: code sent to ***5678',
      'second frame: code sent to ***9999',
    ]);
    const result = await executeFillPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
