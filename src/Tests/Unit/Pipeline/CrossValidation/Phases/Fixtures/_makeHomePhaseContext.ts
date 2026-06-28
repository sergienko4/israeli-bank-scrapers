/**
 * Phase H.T3c.2 — fixture-driven IPipelineContext + homepageUrl
 * builder for the cross-bank HOME per-phase factory.
 *
 * <p>Returns a pair {context, homepageUrl} ready for
 * {@link executeValidateLoginArea} replay. The mediator's
 * {@link getCurrentUrl} returns the fixture's post-navigation URL so
 * production code can compare against `homepageUrl` and decide
 * `didNavigate`. Frame count is driven by the fixture-supplied page
 * mock (zero frames for non-iframe banks; >=2 for iframe-hosted
 * login banks like Hapoalim).
 *
 * <p>Per `mocking-test-guidlines.md` "Mock external dependencies
 * only" + "Prefer lightweight fakes/stubs" — only the mediator
 * surfaces HOME.POST touches (`getCurrentUrl`, `resolveVisible`) are
 * wired from the fixture; all other surfaces fall through to the
 * default mock-mediator's production-safe defaults.
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" + CLAUDE.md "Max 10 lines per method — extract helpers"
 * the public builder delegates to three single-purpose helpers
 * (`buildHomeBrowser`, `buildHomeMediator`, `buildHomeContext`).
 */

import type { Page } from 'playwright-core';

import type { IElementMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { Option } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Pair returned by {@link buildHomePhaseContext} for HOME.POST replay. */
export interface IHomePhaseTestSubject {
  readonly context: IPipelineContext;
  readonly homepageUrl: string;
}

/** Bundled arguments for {@link buildHomePhaseContext}. */
export interface IHomePhaseContextArgs {
  readonly homepageUrl: string;
  readonly postNavUrl: string;
  readonly frameCount: number;
}

/**
 * Build a HOME-stage test subject. Wires the mediator's
 * {@link getCurrentUrl} to the post-navigation URL so HOME.POST's
 * `didNavigate` comparison reflects the captured shape. Constructs
 * the page mock with the requested frame count so the `hasFrames`
 * branch is reachable for iframe-hosted banks.
 *
 * @param args - Bundled arguments (homepageUrl, postNavUrl,
 *   frameCount). Bundled so the function stays under the project's
 *   max-params lint ceiling.
 * @returns Context + homepageUrl pair ready for replay.
 */
export function buildHomePhaseContext(args: IHomePhaseContextArgs): IHomePhaseTestSubject {
  const browser = buildHomeBrowser(args.postNavUrl, args.frameCount);
  const mediator = buildHomeMediator(args.postNavUrl);
  const context = buildHomeContext(browser, mediator, args.homepageUrl);
  return { context, homepageUrl: args.homepageUrl };
}

/**
 * Build the browser-state option for HOME.POST replay. Wraps a page
 * mock that exposes the requested number of frames so the
 * {@link executeValidateLoginArea} `hasFrames` branch is reachable
 * for iframe-hosted-login banks (Hapoalim group).
 *
 * @param postNavUrl - URL the mock page reports after navigation.
 * @param frameCount - Number of child frames the page exposes.
 * @returns Some-wrapped browser state.
 */
function buildHomeBrowser(postNavUrl: string, frameCount: number): Option<IBrowserState> {
  const page = makePageWithFrameCount(postNavUrl, frameCount);
  const browserState = makeMockBrowserState(page);
  return some(browserState);
}

/**
 * Build the mediator option for HOME.POST replay. Stubs
 * {@link getCurrentUrl} + {@link resolveVisible} so HOME.POST's
 * `didNavigate` + `FORM_CHECK` race surface drives off the fixture's
 * post-navigation shape.
 *
 * @param postNavUrl - URL the mediator reports as current.
 * @returns Some-wrapped element mediator.
 */
function buildHomeMediator(postNavUrl: string): Option<IElementMediator> {
  const fixtureMediator = makeMockMediator({
    /**
     * Return the post-nav URL so HOME.POST sees navigation occurred
     * relative to `homepageUrl`.
     * @returns Fixture's post-nav URL.
     */
    getCurrentUrl: (): string => postNavUrl,
    /**
     * Default NOT_FOUND for the FORM_CHECK race — HOME.POST does
     * not require the login form to be already-visible at this
     * point (didNavigate / hasFrames cover the contract).
     * @returns NOT_FOUND race result.
     */
    resolveVisible: (): Promise<typeof NOT_FOUND_RESULT> => Promise.resolve(NOT_FOUND_RESULT),
  });
  return some(fixtureMediator);
}

/**
 * Returns the minimal IPipelineBankConfig for HOME-phase fixtures.
 * Uses account/token defaults -- sufficient for homepage-navigation tests.
 *
 * @param homepageUrl - Bank's homepage URL to pin in {@link IUrls.base}.
 * @returns Minimal config with balanceKind/authStrategyKind defaults.
 */
function buildHomeConfig(homepageUrl: string): IPipelineContext['config'] {
  return {
    urls: { base: homepageUrl },
    balanceKind: 'account' as const,
    authStrategyKind: 'token' as const,
  };
}

/**
 * Assemble the final pipeline context with the supplied browser +
 * mediator and the bank's homepage URL pinned in `config.urls.base`.
 *
 * @param browser - Browser-state option from {@link buildHomeBrowser}.
 * @param mediator - Mediator option from {@link buildHomeMediator}.
 * @param homepageUrl - Bank's homepage URL.
 * @returns Pipeline context ready for HOME.POST replay.
 */
function buildHomeContext(
  browser: Option<IBrowserState>,
  mediator: Option<IElementMediator>,
  homepageUrl: string,
): IPipelineContext {
  const base = makeMockContext({ browser, mediator });
  return { ...base, config: buildHomeConfig(homepageUrl) };
}

/**
 * Build a page mock with a custom frames() length. Spreads on top of
 * {@link makeMockFullPage} so URL/locator/getByText surfaces remain
 * intact for non-frame HOME.POST assertions.
 *
 * @param initialUrl - Starting URL.
 * @param frameCount - Desired length of `page.frames()`.
 * @returns Page mock with the requested frame count.
 */
function makePageWithFrameCount(initialUrl: string, frameCount: number): Page {
  const base = makeMockFullPage(initialUrl);
  /**
   * Build one mock frame element for the synthetic frame list.
   * @returns Mock frame page.
   */
  const buildFrame = (): Page => makeMockFullPage(initialUrl);
  const frames: readonly Page[] = Array.from({ length: frameCount }, buildFrame);
  /**
   * Return the requested number of mock frames so HOME.POST's
   * `hasFrames = frameCount > 1` branch is reachable.
   * @returns Mock frame array.
   */
  const framesFn = (): readonly Page[] => frames;
  return Object.assign(base, { frames: framesFn });
}
