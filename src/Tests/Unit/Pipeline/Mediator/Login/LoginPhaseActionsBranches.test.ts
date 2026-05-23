/**
 * Branch-gap tests for {@link LoginPhaseActions}. Covers the small,
 * single-responsibility helpers that the broader LoginFactory tests
 * exercise only incidentally: checkReadiness branches, preAction
 * fallback, Firefox neterror short-circuit, browser/mediator guards,
 * normalizeSubmitConfig fallback, the structural form-anchor accept /
 * reject matrix, and the OTP-screen tri-state. Each case asserts a
 * single behavior on the REAL exported (or indirectly exercised)
 * helper so Phase 5d's orphan-prune does not lower coverage of the
 * surviving production module.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import {
  executeDiscoverForm,
  extractFormAnchorSelector,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockMediator,
} from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from '../../Infrastructure/TestHelpers.js';

// ─── Shared fixtures ─────────────────────────────────────────────

/** Hapoalim-shaped login URL fragment used by the test fixtures. */
const HAPOALIM_LOGIN_URL = 'https://login.bankhapoalim.co.il/login';

/** Config covering one credential field + Hebrew submit selector. */
const HAPOALIM_PWD_CONFIG: ILoginConfig = {
  loginUrl: HAPOALIM_LOGIN_URL,
  fields: [{ credentialKey: 'password', selectors: [{ kind: 'placeholder', value: 'סיסמה' }] }],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Build a synthetic {@link IFieldContext} tied to the supplied frame —
 * matches what a real `resolveField` returns when PRE locates the
 * password input inside the activeFrame.
 * @param frame - Active Playwright frame (usually the page itself).
 * @returns Field context with placeholder strategy + selector.
 */
function makeFieldCtx(frame: IBrowserState['page']): IFieldContext {
  return {
    selector: 'input#password',
    context: frame,
    resolvedKind: 'placeholder',
    resolvedVia: 'placeholder',
  } as unknown as IFieldContext;
}

/** Default arguments controlling the deep mediator's behavior per case. */
interface IDeepMediatorArgs {
  readonly fieldResult: ReturnType<typeof succeed<IFieldContext>>;
  readonly anchor?: Option<IFormAnchor>;
  readonly submitRace?: IRaceResult;
}

/**
 * Build a mediator wired for the deep code paths exercised by
 * executeDiscoverForm. Mirrors the deep factory in
 * `LoginFactoryDeepCoverage.test.ts`, intentionally — keeps the
 * branch-gap tests honest by reusing the same dependency contract.
 * @param args - Stub overrides per row.
 * @returns Configured mediator stub.
 */
function makeDeepMediator(args: IDeepMediatorArgs): IElementMediator {
  const anchorOpt: Option<IFormAnchor> = args.anchor ?? none();
  const race: IRaceResult = args.submitRace ?? NOT_FOUND_RESULT;
  return makeMockMediator({
    /**
     * Return the canned field-resolution outcome.
     * @returns Procedure carrying the field context.
     */
    resolveField: () => Promise.resolve(args.fieldResult),
    /**
     * Return the canned form-anchor option.
     * @returns Anchor option.
     */
    discoverForm: () => Promise.resolve(anchorOpt),
    /**
     * Return the canned visibility race outcome.
     * @returns Race result.
     */
    resolveVisible: () => Promise.resolve(race),
    /**
     * scopeToForm passthrough — same identity contract as production.
     * @param candidates - Inbound list.
     * @returns Same list.
     */
    scopeToForm: <T>(candidates: T): T => candidates,
  });
}

/**
 * Build a browser context + extract the page so deep tests can stub
 * `resolveField` against a real frame reference.
 * @returns Tuple of {ctx, page} for use in a single test.
 */
function buildCtxAndPage(): {
  readonly ctx: IPipelineContext;
  readonly page: IBrowserState['page'];
} {
  const page = makeScreenshotPage();
  const ctx = makeContextWithBrowser(page);
  const browserSlot = ctx.browser as { readonly value: IBrowserState };
  return { ctx, page: browserSlot.value.page };
}

/**
 * Build a complete branch-test context with a deep mediator wired to
 * the page's field-context. Lifts the common 3-line block
 *   `const { ctx, page } = buildCtxAndPage();`
 *   `const mediator = makeDeepMediator({ fieldResult: succeed(makeFieldCtx(page)) });`
 *   `const ctxWithMediator = { ...ctx, mediator: some(mediator) };`
 * out of every test so the bodies avoid the no-restricted-syntax
 * `nested-call` flag.
 * @returns Ready-to-use context with mediator installed.
 */
function buildBranchCtx(): IPipelineContext {
  const { ctx, page } = buildCtxAndPage();
  const fieldCtx = makeFieldCtx(page);
  const fieldResult = succeed(fieldCtx);
  const mediator = makeDeepMediator({ fieldResult });
  const mediatorSlot = some(mediator);
  return { ...ctx, mediator: mediatorSlot };
}

/** Snapshot/restore MOCK_MODE env so branch tests do not leak state. */
let savedMockMode: string | undefined;

beforeAll((): void => {
  savedMockMode = process.env.MOCK_MODE;
  // MOCK_MODE bypasses awaitFramePrelude's DOM-readiness wait
  // (`if (isMockTimingActive()) return true;`), keeping these unit
  // tests deterministic without standing up a real Playwright page.
  process.env.MOCK_MODE = '1';
});

afterAll((): void => {
  if (savedMockMode === undefined) {
    delete process.env.MOCK_MODE;
  } else {
    process.env.MOCK_MODE = savedMockMode;
  }
});

// ─── extractFormAnchorSelector — accept / reject matrix ──────────

describe('LoginPhaseActions.extractFormAnchorSelector — accept / reject matrix', () => {
  /**
   * Anchor-selector decision matrix — one entry per source-line guard
   * in extractFormAnchorSelector. The helper either returns the
   * selector verbatim (id / `[name="X"]` / `tag.class-name`) or drops
   * it to `''` (none, empty, lone '#', bare tag, positional). Driven
   * via a single config array iterated through `forEach` per CLAUDE.md's
   * "config arrays — no duplication" rule (biome's
   * useIterableCallbackReturn forbids `.map()` for side-effectful
   * callbacks, so `forEach` is the semantically equivalent fit here).
   */
  const anchorMatrixCases = [
    {
      label: 'returns empty string when anchor option is none',
      anchor: none(),
      expected: '',
    },
    {
      label: 'returns empty string when the anchor selector is empty',
      anchor: some({ selector: '' } as unknown as IFormAnchor),
      expected: '',
    },
    {
      label: 'accepts id-based anchors verbatim (#otpLobbyFormPassword)',
      anchor: some({ selector: '#otpLobbyFormPassword' } as unknown as IFormAnchor),
      expected: '#otpLobbyFormPassword',
    },
    {
      label: 'accepts attribute-based anchors (tag[name="X"])',
      anchor: some({ selector: 'form[name="loginForm"]' } as unknown as IFormAnchor),
      expected: 'form[name="loginForm"]',
    },
    {
      label: 'accepts class-based anchors (form.user-login-form — Max fixture)',
      anchor: some({ selector: 'form.user-login-form' } as unknown as IFormAnchor),
      expected: 'form.user-login-form',
    },
    {
      label: 'rejects fragile positional :nth-of-type anchors',
      anchor: some({ selector: 'div:nth-of-type(0)' } as unknown as IFormAnchor),
      expected: '',
    },
    {
      label: 'rejects bare-tag anchors (form, div) with no id/class/attr',
      anchor: some({ selector: 'form' } as unknown as IFormAnchor),
      expected: '',
    },
    {
      label: 'rejects # alone (length === 1 guard)',
      anchor: some({ selector: '#' } as unknown as IFormAnchor),
      expected: '',
    },
  ] as const;

  anchorMatrixCases.forEach(({ label, anchor, expected }) => {
    it(label, (): void => {
      const result = extractFormAnchorSelector(anchor);
      expect(result).toBe(expected);
    });
  });
});

// ─── executeDiscoverForm — guards + neterror short-circuit ──────

describe('LoginPhaseActions.executeDiscoverForm — guard rails', () => {
  it('fails when input.browser slot is absent', async (): Promise<void> => {
    // Source line:
    //   `if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no browser');`
    // The browser slot is the only owner of the Playwright `Page`; PRE
    // cannot probe a non-existent page so it MUST fail loud rather
    // than crash on `input.browser.value.page`.
    const mediatorStub = makeMockMediator();
    const ctx: IPipelineContext = {
      browser: none(),
      mediator: some(mediatorStub),
    } as unknown as IPipelineContext;
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toBe('LOGIN PRE: no browser');
    }
  });

  it('fails when input.mediator slot is absent', async (): Promise<void> => {
    // Source line:
    //   `if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no mediator');`
    // The mediator is the ONLY HTML resolution surface (P7 Black Box).
    // Without it PRE cannot resolve fields — fail loud rather than
    // proceed with a null contract.
    const { ctx } = buildCtxAndPage();
    const ctxNoMediator: IPipelineContext = { ...ctx, mediator: none() };
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctxNoMediator);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toBe('LOGIN PRE: no mediator');
    }
  });

  it('fails loud when Firefox neterror page is detected', async (): Promise<void> => {
    // Source lines (probe block at the top of executeDiscoverForm):
    //   `const neterrorProbe = await probeFirefoxNeterror(page);`
    //   `if (neterrorProbe.isNeterror) { ... return fail(...) }`
    // Patches `page.title` to return Firefox's neterror title so the
    // probe's regex matches. The cold-start gate MUST short-circuit
    // before any DOM scan so a 25-30s downstream cascade is averted.
    const { ctx, page } = buildCtxAndPage();
    // Production Firefox neterror title (en-US locale fixture).
    const neterrorTitle = 'Problem loading page';
    const patchedPage: Page = {
      ...page,
      /**
       * Return Firefox's neterror page title so the probe's regex
       * (FIREFOX_NETERROR_TITLE) matches and isNeterror=true.
       * @returns Neterror title string.
       */
      title: (): Promise<string> => Promise.resolve(neterrorTitle),
    };
    const browserState: IBrowserState = {
      page: patchedPage,
      context: {} as IBrowserState['context'],
      cleanups: [],
    };
    const browserSlot = some(browserState);
    const fieldCtx = makeFieldCtx(patchedPage);
    const fieldResult = succeed(fieldCtx);
    const mediator = makeDeepMediator({ fieldResult });
    const mediatorSlot = some(mediator);
    const ctxNeterror: IPipelineContext = {
      ...ctx,
      browser: browserSlot,
      mediator: mediatorSlot,
    };
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctxNeterror);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('LOGIN PRE: browser error page');
      expect(result.errorMessage).toContain(neterrorTitle);
    }
  });
});

// ─── executeDiscoverForm — checkReadiness branches ──────────────

describe('LoginPhaseActions.executeDiscoverForm — checkReadiness branches', () => {
  it('skips when config.checkReadiness is undefined (proceeds to discovery)', async (): Promise<void> => {
    // Source lines in runCheckReadiness:
    //   `if (!config.checkReadiness) return false;`
    // The skip path: PRE proceeds straight to preAction + field
    // discovery. The discovery's `targets.size` ends up matching the
    // configured field count when resolveField succeeds.
    const ctxWithMediator = buildBranchCtx();
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails with checkReadiness error message when the callback throws', async (): Promise<void> => {
    // Source lines in runCheckReadiness:
    //   `try { await config.checkReadiness(page); return false; }`
    //   `catch (error) { ... return fail(..., \`LOGIN PRE: checkReadiness — ${msg}\`); }`
    // A thrown error inside checkReadiness MUST bubble up as a
    // wrapped fail Procedure carrying the original message — not a
    // bare exception that crashes the orchestrator.
    const ctxWithMediator = buildBranchCtx();
    const readinessError = 'Form ready beacon missing';
    const cfgWithReadiness: ILoginConfig = {
      ...HAPOALIM_PWD_CONFIG,
      /**
       * checkReadiness that throws to exercise the catch arm.
       * @returns Never returns (throws).
       */
      checkReadiness: (): Promise<void> => {
        const err = new ScraperError(readinessError);
        return Promise.reject(err);
      },
    };
    const result = await executeDiscoverForm(cfgWithReadiness, ctxWithMediator);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('LOGIN PRE: checkReadiness');
      expect(result.errorMessage).toContain(readinessError);
    }
  });

  it('returns success when checkReadiness resolves', async (): Promise<void> => {
    // Source lines in runCheckReadiness:
    //   `await config.checkReadiness(page);`
    //   `return false;`
    // The success path (callback resolves) must NOT short-circuit —
    // PRE proceeds to preAction + discovery. Counts the calls to
    // guarantee the production code actually awaited the hook.
    const ctxWithMediator = buildBranchCtx();
    let readinessCallCount = 0;
    const cfgWithReadiness: ILoginConfig = {
      ...HAPOALIM_PWD_CONFIG,
      /**
       * checkReadiness that records the call and resolves cleanly.
       * @returns Resolved void.
       */
      checkReadiness: (): Promise<void> => {
        readinessCallCount += 1;
        return Promise.resolve();
      },
    };
    const result = await executeDiscoverForm(cfgWithReadiness, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(readinessCallCount).toBe(1);
  });
});

// ─── executeDiscoverForm — preAction fallback + throw branches ───

describe('LoginPhaseActions.executeDiscoverForm — preAction branches', () => {
  it('falls back to page when preAction is undefined (succeed(page))', async (): Promise<void> => {
    // Source lines in runPreAction:
    //   `if (!config.preAction) return succeed(page as Page | Frame);`
    // Without an explicit hook, the page itself is the active frame —
    // the field-discovery reduce loop iterates against it.
    const ctxWithMediator = buildBranchCtx();
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('falls back to page when preAction resolves with undefined', async (): Promise<void> => {
    // Source lines in runPreAction:
    //   `const frame = await config.preAction(page);`
    //   `const activeFrame: Page | Frame = frame ?? page;`
    // A preAction that returns `undefined` (Hapoalim-group banks
    // signalling no iframe) must fall back to the page. The login
    // discovery still succeeds because resolveField returns FOUND.
    const ctxWithMediator = buildBranchCtx();
    let preActionCallCount = 0;
    const cfgWithPreAction: ILoginConfig = {
      ...HAPOALIM_PWD_CONFIG,
      /**
       * preAction that resolves with undefined to exercise the
       * `?? page` fallback inside runPreAction.
       * @returns Resolved undefined frame.
       */
      preAction: (): Promise<undefined> => {
        preActionCallCount += 1;
        return Promise.resolve(undefined);
      },
    };
    const result = await executeDiscoverForm(cfgWithPreAction, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(preActionCallCount).toBe(1);
  });

  it('fails with preAction error message when the callback throws', async (): Promise<void> => {
    // Source lines in runPreAction:
    //   `} catch (error) {`
    //   `  return fail(ScraperErrorTypes.Generic, \`LOGIN PRE: preAction — ${msg}\`);`
    // A thrown preAction must be wrapped, mirroring the
    // checkReadiness catch arm. Confirms no bank-specific exception
    // leaks past the catch boundary.
    const ctxWithMediator = buildBranchCtx();
    const preActionError = 'Reveal click rejected by toggle';
    const cfgWithPreAction: ILoginConfig = {
      ...HAPOALIM_PWD_CONFIG,
      /**
       * preAction that throws to exercise the catch arm.
       * @returns Never returns (throws).
       */
      preAction: (): Promise<undefined> => {
        const err = new ScraperError(preActionError);
        return Promise.reject(err);
      },
    };
    const result = await executeDiscoverForm(cfgWithPreAction, ctxWithMediator);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('LOGIN PRE: preAction');
      expect(result.errorMessage).toContain(preActionError);
    }
  });
});

// ─── normalizeSubmitConfig fallback + resolveSubmitTarget branches

describe('LoginPhaseActions.executeDiscoverForm — submit-resolution branches', () => {
  it('wins via structural xpath when WK submitStructural matches first', async (): Promise<void> => {
    // Exercises resolveSubmitTarget's first arm (lines around the
    // `structural` constant) — the WK_LOGIN_FORM.submitStructural
    // candidates (`//button[@type="submit"]`) win the race before
    // the text-based fallback is consulted. The discovered submit
    // target's `contextId` matches the password's frame.
    const { ctx, page } = buildCtxAndPage();
    const submitRace: IRaceResult = {
      found: true,
      locator: false,
      candidate: { kind: 'xpath', value: '//button[@type="submit"]' },
      context: page,
      index: 0,
      value: 'submit',
      identity: false,
    };
    const fieldCtx = makeFieldCtx(page);
    const fieldResult = succeed(fieldCtx);
    const mediator = makeDeepMediator({ fieldResult, submitRace });
    const mediatorSlot = some(mediator);
    const ctxWithMediator: IPipelineContext = { ...ctx, mediator: mediatorSlot };
    const result = await executeDiscoverForm(HAPOALIM_PWD_CONFIG, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk && result.value.loginFieldDiscovery.has) {
      const discovery = result.value.loginFieldDiscovery.value;
      expect(discovery.submitTarget.has).toBe(true);
    }
  });

  it('falls back to WK submit candidates when config.submit is an empty array', async (): Promise<void> => {
    // Source lines in normalizeSubmitConfig:
    //   `if (Array.isArray(submit) && submit.length > 0) return submit;`
    //   `if (!Array.isArray(submit)) return [submit];`
    //   `return WK_LOGIN_FORM.submit;`
    // An empty `submit: []` falls through both guards and the helper
    // returns the WK_LOGIN_FORM.submit catalog. Because every WK and
    // structural attempt misses (NOT_FOUND_RESULT), executeDiscoverForm
    // still succeeds — the absent submit target is non-fatal at PRE.
    const ctxWithMediator = buildBranchCtx();
    const cfgEmptySubmit: ILoginConfig = {
      ...HAPOALIM_PWD_CONFIG,
      submit: [],
    };
    const result = await executeDiscoverForm(cfgEmptySubmit, ctxWithMediator);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk && result.value.loginFieldDiscovery.has) {
      expect(result.value.loginFieldDiscovery.value.submitTarget.has).toBe(false);
    }
  });
});
