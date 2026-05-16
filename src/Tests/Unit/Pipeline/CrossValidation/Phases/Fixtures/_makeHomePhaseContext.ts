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
 */

import type { Page } from 'playwright-core';

import { NOT_FOUND_RESULT } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';
import type { IPhaseHFixture } from './_makePhaseFixture.js';

/** Pair returned by {@link buildHomePhaseContext} for HOME.POST replay. */
export interface IHomePhaseTestSubject {
  readonly context: IPipelineContext;
  readonly homepageUrl: string;
}

/** Bundled arguments for {@link buildHomePhaseContext}. */
export interface IHomePhaseContextArgs {
  readonly fixture: IPhaseHFixture;
  readonly homepageUrl: string;
  readonly postNavUrl: string;
  readonly frameCount: number;
}

/**
 * Build a HOME-stage test subject from a fixture. Wires the mediator's
 * {@link getCurrentUrl} to the post-navigation URL so HOME.POST's
 * `didNavigate` comparison reflects the captured shape. Constructs the
 * page mock with the requested frame count so the `hasFrames` branch
 * is reachable for iframe-hosted banks.
 *
 * @param args - Bundled arguments (fixture, homepageUrl, postNavUrl,
 *   frameCount). Bundled so the function stays under the project's
 *   max-params lint ceiling.
 * @returns Context + homepageUrl pair ready for replay.
 */
export function buildHomePhaseContext(args: IHomePhaseContextArgs): IHomePhaseTestSubject {
  const { fixture, homepageUrl, postNavUrl, frameCount } = args;
  const page: Page = makePageWithFrameCount(postNavUrl, frameCount);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const fixtureMediator = makeMockMediator({
    /**
     * Return the post-nav URL so HOME.POST sees navigation
     * occurred relative to `homepageUrl`.
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
  const mediator = some(fixtureMediator);
  const base = makeMockContext({ browser, mediator });
  // Tag the test logger with the fixture's bank id so debug output
  // from production code surfaces the right scenario when the cross-
  // bank parameterisation prints assertion failures.
  const taggedLogger = withBankTag(base.logger, fixture.meta.bank);
  const context = { ...base, logger: taggedLogger, config: { urls: { base: homepageUrl } } };
  return { context, homepageUrl };
}

/**
 * Wrap the mock logger so every debug call carries the fixture's bank
 * id. Keeps the per-row diagnostic trail attributed to the right bank
 * in `it.each` failures without leaking real captured PII.
 *
 * @param base - Mock logger from {@link makeMockContext} defaults.
 * @param bank - Bank id from the fixture meta block.
 * @returns Logger that prefixes debug payloads with the bank tag.
 */
function withBankTag(base: IPipelineContext['logger'], bank: string): IPipelineContext['logger'] {
  return {
    ...base,
    /**
     * Annotate the debug payload with the fixture's bank id.
     * @param payload - Original debug call payload.
     * @returns True (no-op logger contract).
     */
    debug: (payload: object): boolean => {
      base.debug({ ...payload, fixtureBank: bank });
      return true;
    },
  };
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
  const frames: readonly Page[] = Array.from(
    { length: frameCount },
    (): Page => makeMockFullPage(initialUrl),
  );
  return {
    ...base,
    /**
     * Return the requested number of mock frames so HOME.POST's
     * `hasFrames = frameCount > 1` branch is reachable.
     * @returns Mock frame array.
     */
    frames: (): readonly Page[] => frames,
  } as unknown as Page;
}
