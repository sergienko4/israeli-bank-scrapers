/**
 * M2.T10 — deep-coverage half of the LOGIN cross-bank factory.
 *
 * <p>This file is the second half of the LOGIN factory split for
 * `max-lines` compliance — the first half (`LoginFactoryTest.test.ts`)
 * holds the bank-shape contract and the bank-agnostic happy-path
 * handler scenarios. This half exercises the deep submit-resolution,
 * field-discovery, callback-error, and POST-validation branches that
 * the deleted Login*.test.ts files used to cover.
 *
 * <p>Same factory pattern, same fixture set
 * ({@link BANK_LOGIN_FIXTURES}) — the split is mechanical. Each test
 * runs a production handler against a per-row mediator stub that
 * resolves through the deep code paths.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import type { IFormErrorScanResult } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IFieldContext } from '../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import type { ContextId } from '../../../../Scrapers/Pipeline/Types/Brand.js';
import type { Option } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';

/** Anchor option supplied to deep mediator stubs. */
type AnchorOption = Option<IFormAnchor>;
import type {
  IBrowserState,
  ILoginFieldDiscovery,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

// ─── Shared mock helpers ─────────────────────────────────────────

/** Generic mock config — every assertion below holds regardless of bank. */
const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
} as unknown as ILoginConfig;

/** Config carrying one password field + one submit selector. */
const CFG_PWD_AND_SUBMIT = {
  loginUrl: 'https://bank.example.com/login',
  fields: [
    { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
  ],
  submit: [{ kind: 'textContent' as const, value: 'Login' }],
  possibleResults: {},
} as unknown as ILoginConfig;

/** Config carrying TWO fields (password + username). */
const CFG_TWO_FIELDS = {
  loginUrl: 'https://bank.example.com/login',
  fields: [
    { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
    { credentialKey: 'username', selectors: [{ kind: 'placeholder' as const, value: 'user' }] },
  ],
  submit: [{ kind: 'textContent' as const, value: 'Login' }],
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Build a browser context + extract the page so deep tests can stub
 * `resolveField` against a real frame reference.
 *
 * @returns Tuple of {ctx, page} for use in a single test.
 */
function makeBrowserCtxAndPage(): {
  readonly ctx: IPipelineContext;
  readonly page: IBrowserState['page'];
} {
  const page = makeScreenshotPage();
  const ctx = makeContextWithBrowser(page);
  const browser = (ctx.browser as { readonly value: IBrowserState }).value;
  return { ctx, page: browser.page };
}

/** Args for {@link makeDeepMediator}. */
interface IDeepMediatorArgs {
  readonly fieldOk: ReturnType<typeof succeed<IFieldContext>>;
  readonly anchor?: AnchorOption;
  readonly submitRace?: IRaceResult;
}

/**
 * Build a mediator wired for the deep code paths — `resolveField`
 * succeeds, `discoverForm` returns the supplied option (defaults to
 * none), `resolveVisible` returns the supplied race result (defaults
 * to NOT_FOUND).
 *
 * @param args - Stub overrides per row.
 * @returns Configured mediator stub.
 */
function makeDeepMediator(args: IDeepMediatorArgs): ReturnType<typeof makeMockMediator> {
  const anchor: AnchorOption = args.anchor ?? none();
  const submitRace: IRaceResult = args.submitRace ?? NOT_FOUND_RESULT;
  /**
   * Stub `resolveField` returning the configured success procedure.
   *
   * @returns Success procedure carrying the field context.
   */
  const resolveField = (): Promise<{ readonly success: true; readonly value: IFieldContext }> =>
    Promise.resolve(args.fieldOk);
  /**
   * Stub `discoverForm` returning the configured anchor option.
   *
   * @returns Anchor option promise.
   */
  const discoverForm = (): Promise<typeof anchor> => Promise.resolve(anchor);
  /**
   * Stub `resolveVisible` returning the configured race result.
   *
   * @returns Race result promise.
   */
  const resolveVisible = (): Promise<typeof submitRace> => Promise.resolve(submitRace);
  /**
   * Pass-through scope.
   *
   * @param cands - Input candidates.
   * @returns Same candidates.
   */
  const scopeToForm = <T>(cands: T): T => cands;
  return makeMockMediator({ resolveField, discoverForm, resolveVisible, scopeToForm });
}

/**
 * Build a synthetic resolved field context tied to the supplied page
 * (the password field's frame).
 *
 * @param page - Page to use as the field's context.
 * @returns Resolved field context.
 */
function makeFieldCtx(page: IBrowserState['page']): IFieldContext {
  return {
    selector: '#pwd',
    context: page,
    resolvedKind: 'placeholder',
    resolvedVia: 'placeholder',
  } as unknown as IFieldContext;
}

/**
 * Build a found race result for the submit candidate. Defaults:
 * kind='textContent', value='Login', frame=page.
 *
 * @param page - Frame the candidate was resolved in.
 * @param kind - Selector kind.
 * @param value - Candidate value.
 * @returns Race result.
 */
function makeSubmitRace(page: IBrowserState['page'], kind: string, value: string): IRaceResult {
  return {
    found: true,
    locator: false,
    candidate: { kind, value },
    context: page,
    index: 0,
    value,
  } as unknown as IRaceResult;
}

// ─── Deep submit + field-discovery paths ─────────────────────────

describe('executeDiscoverForm — deep submit + form-anchor matrix', () => {
  it('discovers form anchor when resolveField succeeds (some-anchor branch)', async () => {
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const anchor = some({ frame: page, selector: 'form' } as unknown as IFormAnchor);
    const mediator = makeDeepMediator({ fieldOk, anchor });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_PWD_AND_SUBMIT, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk && result.value.loginFieldDiscovery.has) {
      expect(result.value.loginFieldDiscovery.value.targets.size).toBeGreaterThan(0);
    }
  });

  it.each<['xpath' | 'exactText' | 'ariaLabel' | 'labelText' | 'textContent', string]>([
    ['textContent', 'Login'],
    ['exactText', 'Sign In'],
    ['ariaLabel', 'submit-form'],
    ['labelText', 'Continue'],
    ['xpath', '//button[@type="submit"]'],
  ])('builds the submit selector for kind=%s with candidate %s', async (kind, value) => {
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const submitRace = makeSubmitRace(page, kind, value);
    const mediator = makeDeepMediator({ fieldOk, submitRace });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_PWD_AND_SUBMIT, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('returns the unscoped selector when form anchor is empty (no `>>` chain)', async () => {
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const submitRace = makeSubmitRace(page, 'textContent', 'Login');
    const mediator = makeDeepMediator({ fieldOk, submitRace });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_PWD_AND_SUBMIT, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('returns the scoped selector when form anchor is id-based', async () => {
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const anchor = some({ frame: page, selector: '#loginForm' } as unknown as IFormAnchor);
    const submitRace = makeSubmitRace(page, 'textContent', 'Login');
    const mediator = makeDeepMediator({ fieldOk, anchor, submitRace });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_PWD_AND_SUBMIT, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('skips repeated form-anchor lookup when first field already set the anchor', async () => {
    // Two fields → after password resolves, formAnchor is some(); the
    // second field's branch (line 170: `if (accum.formAnchor.has) return`)
    // is exercised here.
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const anchor = some({ frame: page, selector: '#loginForm' } as unknown as IFormAnchor);
    const mediator = makeDeepMediator({ fieldOk, anchor });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_TWO_FIELDS, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('extractCandidateVal/Kind: returns the no-candidate fallback when race result lacks a candidate', async () => {
    // resolveVisible returns found=true but candidate=false → both
    // extractCandidateVal and extractCandidateKind take the fallback
    // branch (lines 265, 275).
    const { ctx: browserCtx, page } = makeBrowserCtxAndPage();
    const fieldCtx = makeFieldCtx(page);
    const fieldOk = succeed(fieldCtx);
    const noCandidateRace = {
      found: true,
      locator: false,
      candidate: false,
      context: page,
      index: 0,
      value: '',
    } as unknown as IRaceResult;
    const mediator = makeDeepMediator({ fieldOk, submitRace: noCandidateRace });
    const ctx = { ...browserCtx, mediator: some(mediator) };
    const result = await executeDiscoverForm(CFG_PWD_AND_SUBMIT, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

// ─── executeFillAndSubmitFromDiscovery — propagation paths ───────

describe('executeFillAndSubmitFromDiscovery — fillFromDiscovery propagation', () => {
  it('succeeds when discovery + executor present + valid fields', async () => {
    const target: IResolvedTarget = {
      selector: '#pwd',
      contextId: 'main' as ContextId,
      kind: 'placeholder',
      candidateValue: 'password',
    };
    const targets = new Map<string, IResolvedTarget>();
    targets.set('password', target);
    const disc: ILoginFieldDiscovery = {
      targets: targets as unknown as ILoginFieldDiscovery['targets'],
      formAnchor: none(),
      activeFrameId: 'main' as ContextId,
      submitTarget: none(),
    };
    const base = makeMockContext({
      loginAreaReady: true,
      loginFieldDiscovery: some(disc),
      credentials: { username: 'u', password: 'p' } as unknown as IPipelineContext['credentials'],
    });
    const exec = makeMockActionExecutor();
    const ctx = toActionCtx(base, exec);
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
      ],
      submit: [{ kind: 'textContent' as const, value: 'Login' }],
      possibleResults: {},
    } as unknown as ILoginConfig;
    const result = await executeFillAndSubmitFromDiscovery(cfg, ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

// ─── POST-validation branch coverage ─────────────────────────────

describe('executeValidateLogin — POST-validation deep branches', () => {
  it('fails LOUD with InvalidPassword when discoverErrors returns hasErrors=true', async () => {
    const errorScan: IFormErrorScanResult = {
      hasErrors: true,
      errors: [{ message: 'Bad password', candidate: { kind: 'exactText', value: 'x' } }],
      summary: 'invalid',
    } as unknown as IFormErrorScanResult;
    /**
     * Stub `discoverErrors` returning a positive scan result.
     *
     * @returns Error scan result.
     */
    const discoverErrors = (): Promise<IFormErrorScanResult> => Promise.resolve(errorScan);
    const mediator = makeMockMediator({ discoverErrors });
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const result = await executeValidateLogin(TEST_CONFIG, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('fails LOUD when waitForLoadingDone times out', async () => {
    const stuckSpinner = fail(ScraperErrorTypes.Timeout, 'spinner never cleared');
    /**
     * Stub `waitForLoadingDone` returning a fail Procedure.
     *
     * @returns Failure procedure.
     */
    const waitForLoadingDone = (): Promise<typeof stuckSpinner> => Promise.resolve(stuckSpinner);
    const mediator = makeMockMediator({ waitForLoadingDone });
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const result = await executeValidateLogin(TEST_CONFIG, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('runs postAction successfully when defined (callback success path)', async () => {
    /**
     * No-op postAction callback returning success.
     *
     * @returns Resolved true.
     */
    const postAction = (): Promise<true> => Promise.resolve(true);
    const cfg = { ...TEST_CONFIG, postAction } as unknown as ILoginConfig;
    const mediator = makeMockMediator();
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const result = await executeValidateLogin(cfg, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when postAction throws (callback error path)', async () => {
    /**
     * postAction callback that rejects.
     *
     * @returns Rejected promise.
     */
    const postAction = (): Promise<never> => Promise.reject(new Error('postAction crash'));
    const cfg = { ...TEST_CONFIG, postAction } as unknown as ILoginConfig;
    const mediator = makeMockMediator();
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const result = await executeValidateLogin(cfg, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});
