/**
 * Phase H+ — deep-coverage LOGIN context builder honoring the
 * originally-locked H.T3c.4 spec: "FULL Playwright-page mocked
 * replay (PRE → ACTION → POST → FINAL)". The factory chain runs
 * `executeDiscoverForm` → `executeFillAndSubmitFromDiscovery` →
 * `executeValidateLogin` → `executeLoginSignal` end-to-end per
 * bank, with the mediator surfaces required at each sub-step
 * wired to return success values that match the captured-shape
 * last-good fixture.
 *
 * <p>The page instance is shared between the browser state and
 * every stubbed mediator surface — production
 * {@link computeContextId} compares by reference, so the same
 * page object must flow through `IFieldContext.context` /
 * `IFormAnchor.context` / `IRaceResult.context` for the
 * MAIN_CONTEXT_ID short-circuit to fire.
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" each builder is split into single-purpose helpers
 * (`buildDeepLoginBrowser`, `buildDeepLoginMediator`,
 * `buildDeepLoginExecutor`, plus the per-surface stub builders).
 */

import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IActionMediator,
  ICookieSnapshot,
  IElementMediator,
  IRaceResult,
} from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import type { IFieldContext } from '../../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import type { Option } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor } from '../../../Infrastructure/TestHelpers.js';

/** Bundled arguments for the deep LOGIN context builder. */
export interface IDeepLoginContextArgs {
  readonly loginConfig: ILoginConfig;
  readonly loginUrl: string;
  readonly cookies: readonly ICookieSnapshot[];
}

/** Result of {@link buildDeepLoginContext} — PRE+ACTION+POST+FINAL ready. */
export interface IDeepLoginTestSubject {
  readonly context: IPipelineContext;
  readonly executor: IActionMediator;
}

/**
 * Build a fixture-driven context where every mediator + executor
 * surface read by the LOGIN chain returns success. Drives all four
 * sub-steps (PRE → ACTION → POST → FINAL) through production code.
 *
 * @param args - Bundled arguments (loginConfig, loginUrl, cookies).
 * @returns Test subject containing the context + sealed executor.
 */
export function buildDeepLoginContext(args: IDeepLoginContextArgs): IDeepLoginTestSubject {
  const context = composeDeepLoginContext(args);
  const executor = buildDeepLoginExecutor();
  return { context, executor };
}

/**
 * Compose the deep LOGIN {@link IPipelineContext}. Split out so the
 * public builder stays under the 10-line cap.
 *
 * @param args - Bundled arguments (loginConfig, loginUrl, cookies).
 * @returns Fully-wired pipeline context.
 */
function composeDeepLoginContext(args: IDeepLoginContextArgs): IPipelineContext {
  const basePage = makeMockFullPage(args.loginUrl);
  const page: Page = enrichDeepPage(basePage);
  const browser = buildDeepLoginBrowser(page);
  const mediator = buildDeepLoginMediator(page, args.loginUrl, args.cookies);
  const credentials = synthesizeCredentials(args.loginConfig);
  const config = buildDeepLoginConfig(args.loginUrl);
  const base = makeMockContext({ browser, mediator });
  return { ...base, credentials, config };
}

/**
 * Build the deep LOGIN pipeline config. Extracted so the composer stays
 * under the 10-line cap now that `balanceKind` is a required field.
 *
 * @param loginUrl - Base URL for the pipeline config.
 * @returns Pipeline config with a required account `balanceKind`.
 */
function buildDeepLoginConfig(loginUrl: string): IPipelineContext['config'] {
  return { urls: { base: loginUrl }, balanceKind: 'account', authStrategyKind: 'token' };
}

/**
 * Augment the mock page with `evaluate` + `title` stubs that the
 * production OTP-TRIGGER PRE (phone-hint extraction) and INIT
 * POST (Firefox-neterror probe) read. Returns null / empty so
 * the production guards treat the probe as "not present" and
 * continue down the success path.
 *
 * @param base - Base page from {@link makeMockFullPage}.
 * @returns Enriched page covering more production read surfaces.
 */
function enrichDeepPage(base: Page): Page {
  const enriched = {
    ...base,
    /**
     * No-op evaluate - production reads phone-hint string from DOM;
     * returning empty string routes the phone-hint through the FAKE
     * fallback.
     * @returns Resolved empty string.
     */
    evaluate: (): Promise<string> => Promise.resolve(''),
    /**
     * Mock title - Firefox neterror probe checks for known error
     * page titles; returning empty string treats the probe as
     * "not a neterror page".
     * @returns Empty title.
     */
    title: (): Promise<string> => Promise.resolve(''),
  } as Page;
  return enriched;
}

/**
 * Build a FAKE credentials record carrying every key declared in
 * the bank's `loginConfig.fields`. ACTION's `fillFromDiscovery`
 * fails loud when any expected credential is missing, so the test
 * subject must populate them up-front.
 *
 * @param loginConfig - Bank-specific login configuration.
 * @returns Credentials record with all required keys set to FAKE.
 */
function synthesizeCredentials(loginConfig: ILoginConfig): IPipelineContext['credentials'] {
  const entries = loginConfig.fields.map((field): readonly [string, string] => [
    field.credentialKey,
    'FAKE',
  ]);
  return Object.fromEntries(entries) as IPipelineContext['credentials'];
}

/**
 * Wrap the shared page in a mock browser state option.
 *
 * @param page - Shared mock page used by every stub.
 * @returns Some-wrapped browser state.
 */
function buildDeepLoginBrowser(page: Page): Option<IBrowserState> {
  const browserState = makeMockBrowserState(page);
  return some(browserState);
}

/**
 * Build the mediator option wired for the full LOGIN chain. The
 * shared `page` reference threads through every stub so production
 * {@link computeContextId} resolves to MAIN_CONTEXT_ID instead of
 * crashing on the mock-page's missing `name()` accessor.
 *
 * @param page - Shared mock page reused as each stub's context.
 * @param loginUrl - URL the mediator reports as current.
 * @param cookies - Redacted cookie snapshot for FINAL audit.
 * @returns Some-wrapped element mediator.
 */
function buildDeepLoginMediator(
  page: Page,
  loginUrl: string,
  cookies: readonly ICookieSnapshot[],
): Option<IElementMediator> {
  const stubs = buildDeepLoginMediatorStubs(page, loginUrl, cookies);
  const fixtureMediator = makeMockMediator(stubs);
  return some(fixtureMediator);
}

/**
 * Bundle the mediator stub overrides used by the deep LOGIN test
 * subject. Surfacing them as a single bundle keeps
 * {@link buildDeepLoginMediator} under the project's line cap.
 *
 * @param page - Shared mock page reused as each stub's context.
 * @param loginUrl - URL the mediator reports as current.
 * @param cookies - Redacted cookie snapshot for FINAL audit.
 * @returns Stub overrides ready for {@link makeMockMediator}.
 */
function buildDeepLoginMediatorStubs(
  page: Page,
  loginUrl: string,
  cookies: readonly ICookieSnapshot[],
): Parameters<typeof makeMockMediator>[0] {
  const pageStubs = buildPageStubs(page);
  return { ...pageStubs, ...buildDeepLoginSessionStubs(loginUrl, cookies) };
}

/** Page-scoped mediator stub bundle returned by {@link buildPageStubs}. */
type PageStubsBundle = Pick<
  NonNullable<Parameters<typeof makeMockMediator>[0]>,
  'resolveField' | 'discoverForm' | 'resolveVisible' | 'resolveAllVisible'
>;

/**
 * Bundle the three page-scoped mediator stubs (resolveField,
 * discoverForm, resolveVisible) so {@link buildDeepLoginMediatorStubs}
 * stays under the project's line cap.
 *
 * @param page - Shared mock page reused as each stub's context.
 * @returns Page-scoped stub overrides.
 */
function buildPageStubs(page: Page): PageStubsBundle {
  return {
    resolveField: buildResolveFieldStub(page),
    discoverForm: buildDiscoverFormStub(page),
    resolveVisible: buildResolveVisibleStub(page),
    resolveAllVisible: buildResolveAllVisibleStub(page),
  };
}

/**
 * Build the session-side stubs (cookie snapshot + URL accessor) for
 * the deep LOGIN mediator. Split out so the parent stub-builder
 * fits the project's 10-line method cap.
 *
 * @param loginUrl - URL the mediator reports as current.
 * @param cookies - Redacted cookie snapshot for FINAL audit.
 * @returns Object carrying the `getCookies` + `getCurrentUrl` overrides.
 */
function buildDeepLoginSessionStubs(
  loginUrl: string,
  cookies: readonly ICookieSnapshot[],
): Pick<NonNullable<Parameters<typeof makeMockMediator>[0]>, 'getCookies' | 'getCurrentUrl'> {
  /**
   * Return the fixture-redacted cookie snapshot for FINAL.
   * @returns Fixture cookies.
   */
  const getCookies = (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookies);
  /**
   * Return the bank's login URL for logging + URL comparisons.
   * @returns Login URL.
   */
  const getCurrentUrl = (): string => loginUrl;
  return { getCookies, getCurrentUrl };
}

/**
 * Build the executor used by ACTION (fill+click). Default mock
 * executor succeeds on every fill + click, matching captured
 * last-good behaviour.
 *
 * @returns IActionMediator with success defaults.
 */
function buildDeepLoginExecutor(): IActionMediator {
  return makeMockActionExecutor();
}

/** Result shape returned by {@link IElementMediator.resolveField}. */
type ResolveFieldResult = Awaited<ReturnType<IElementMediator['resolveField']>>;

/**
 * Build a `resolveField` stub that returns a success
 * {@link IFieldContext} for every requested field key. The
 * `context` is the SHARED page reference so production
 * {@link computeContextId} returns MAIN_CONTEXT_ID without
 * touching the mock's missing Frame methods.
 *
 * @param page - Shared page reused as the field's context.
 * @returns Stub function compatible with {@link IElementMediator.resolveField}.
 */
function buildResolveFieldStub(page: Page): IElementMediator['resolveField'] {
  return (key: string): Promise<ResolveFieldResult> => {
    const fieldCtx = makeFieldCtx(page, key);
    const ok = succeed(fieldCtx);
    return Promise.resolve(ok);
  };
}

/**
 * Synthesise a resolved {@link IFieldContext} for one WK field key.
 *
 * @param page - Shared mock page reused as the field's context.
 * @param key - WK field key requested by ACTION.
 * @returns Field context anchored at the shared page.
 */
function makeFieldCtx(page: Page, key: string): IFieldContext {
  return {
    isResolved: true,
    selector: `[data-test-field="${key}"]`,
    context: page,
    resolvedVia: 'wellKnown',
    round: 'mainPage',
    resolvedKind: 'placeholder',
  };
}

/**
 * Build a `discoverForm` stub returning a synthetic
 * {@link IFormAnchor} whose context is the SHARED page reference
 * so submit-target scope resolution stays on MAIN_CONTEXT_ID.
 *
 * @param page - Shared page reused as the form's context.
 * @returns Stub function compatible with {@link IElementMediator.discoverForm}.
 */
function buildDiscoverFormStub(page: Page): IElementMediator['discoverForm'] {
  return (): Promise<Option<IFormAnchor>> => {
    const anchor: IFormAnchor = {
      selector: 'form[data-test-id="login-form"]',
      context: page,
    };
    const anchorOption = some(anchor);
    return Promise.resolve(anchorOption);
  };
}

/**
 * Build a `resolveVisible` stub returning a found
 * {@link IRaceResult} for submit-target lookups so ACTION can
 * locate the submit button and POST can probe error banners as
 * NOT_FOUND. The `context` is the SHARED page reference.
 *
 * @param page - Shared page reused as the race result's context.
 * @returns Stub function compatible with {@link IElementMediator.resolveVisible}.
 */
function buildResolveVisibleStub(page: Page): IElementMediator['resolveVisible'] {
  return (): Promise<IRaceResult> => {
    const result = makeFoundRaceResult(page);
    return Promise.resolve(result);
  };
}

/**
 * Synthesise the found {@link IRaceResult} for submit-target lookups.
 *
 * @param page - Shared mock page reused as the race result's context.
 * @returns Race result anchored at the shared page.
 */
function makeFoundRaceResult(page: Page): IRaceResult {
  return {
    ...NOT_FOUND_RESULT,
    found: true,
    candidate: { kind: 'textContent' as const, value: 'submit' },
    context: page,
    value: 'submit',
    identity: false,
  };
}

/**
 * Build a `resolveAllVisible` stub returning the single found
 * {@link IRaceResult} so HOME.PRE (`resolveHomeTrigger` races
 * `resolveAllVisible`, not `resolveVisible`) locates a login trigger.
 * Without this the mediator default returns `[]` and PRE fails with
 * "no login nav link found".
 *
 * @param page - Shared page reused as the race result's context.
 * @returns Stub function compatible with {@link IElementMediator.resolveAllVisible}.
 */
function buildResolveAllVisibleStub(page: Page): IElementMediator['resolveAllVisible'] {
  return (): Promise<readonly IRaceResult[]> => {
    const result = makeFoundRaceResult(page);
    return Promise.resolve([result]);
  };
}
