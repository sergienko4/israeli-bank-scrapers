/**
 * Branch-gap tests for the Phase 12d
 * {@link ../../../../../Scrapers/Pipeline/Mediator/Login/SubmitResolve/SubmitResolveCore.ts | SubmitResolveCore}
 * race-frame matcher.
 *
 * The integration test in `LoginPhaseActionsBranches.test.ts` exercises
 * only the structural happy path (same-frame win); this file covers
 * the not-found and wrong-frame arms so the split does not drop
 * branch coverage on the surviving production module.
 */
import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { computeContextId } from '../../../../../Scrapers/Pipeline/Mediator/Elements/FrameRegistry.js';
import type { IDiscoverFieldsArgs } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.types.js';
import { resolveInFrame } from '../../../../../Scrapers/Pipeline/Mediator/Login/SubmitResolve/SubmitResolveCore.js';
import type { IResolveInFrameArgs } from '../../../../../Scrapers/Pipeline/Mediator/Login/SubmitResolve/SubmitResolveTypes.js';
import { makeMockMediator } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger, makeScreenshotPage } from '../../Infrastructure/TestHelpers.js';
import { makeMockFrame, makeMockPage } from '../Elements/FrameMocks.js';

const CANDIDATE: SelectorCandidate = { kind: 'textContent', value: 'כניסה' };
const CANDIDATES: readonly SelectorCandidate[] = [CANDIDATE];
const ANCHOR = 'form#login';
const STUB_CONFIG: ILoginConfig = {
  loginUrl: 'https://x',
  fields: [],
  submit: [],
  possibleResults: {},
} as unknown as ILoginConfig;

/** Args shared by every resolveInFrame fixture; only `args` + `requiredFrameId` vary per test. */
const STATIC_RESOLVE_ARGS: Pick<IResolveInFrameArgs, 'candidates' | 'formAnchor'> = {
  candidates: CANDIDATES,
  formAnchor: ANCHOR,
};

/** Static fields of a found main-frame race; only `context` varies per test. */
const BASE_MAIN_FRAME_RACE: Omit<IRaceResult, 'context'> = {
  found: true,
  locator: false,
  candidate: CANDIDATE,
  index: 0,
  value: 'submit',
  identity: false,
};

/**
 * Build a minimal IDiscoverFieldsArgs bundle around a mediator + page.
 * @param page - Mock Page used as activeFrame.
 * @param mediator - Mediator stub whose resolveVisible is controlled per test.
 * @returns IDiscoverFieldsArgs suitable for resolveInFrame.
 */
function buildDiscoverArgs(page: Page, mediator: IElementMediator): IDiscoverFieldsArgs {
  return {
    mediator,
    config: STUB_CONFIG,
    activeFrame: page,
    page,
    logger: makeFlushableLogger(),
  };
}

/**
 * Build a resolveInFrame args bundle wired to the given mediator.
 * @param page - Mock Page used as activeFrame.
 * @param mediator - Mediator stub.
 * @param requiredFrameId - Frame id the matcher must accept (MAIN by default).
 * @returns IResolveInFrameArgs.
 */
function buildArgs(
  page: Page,
  mediator: IElementMediator,
  requiredFrameId: string,
): IResolveInFrameArgs {
  return { ...STATIC_RESOLVE_ARGS, args: buildDiscoverArgs(page, mediator), requiredFrameId };
}

/**
 * Stub mediator that returns a canned IRaceResult from resolveVisible.
 * @param race - Race result to return.
 * @returns Mock IElementMediator.
 */
function makeRacingMediator(race: IRaceResult): IElementMediator {
  return makeMockMediator({
    /**
     * Return the canned race outcome.
     * @returns Race result.
     */
    resolveVisible: () => Promise.resolve(race),
  });
}

/**
 * Build a found-in-main-frame race result for the success/wrong-frame tests.
 * @param page - The mock page that owns the match.
 * @returns IRaceResult marked found with context = page.
 */
function makeMainFrameRace(page: Page): IRaceResult {
  return { ...BASE_MAIN_FRAME_RACE, context: page };
}

/** URL of the iframe the submit button lives in. */
const IFRAME_URL = 'https://bank.co.il/login';

/**
 * Build a screenshot-capable page that reports a real child-frame list.
 *
 * <p>contextId comparison resolves both ids against the live page, so a
 * race landing in a frame the page does not list can never be matched.
 * @param frames - Child frames the page should report.
 * @returns Page whose frames() includes main plus `frames`.
 */
function makeFramedPage(frames: Frame[]): Page {
  const base = makeScreenshotPage();
  const mainFrame = makeMockFrame('about:main');
  const all = [mainFrame, ...frames];
  return {
    ...base,
    /**
     * Report main plus every child frame.
     * @returns Frame array.
     */
    frames: (): Frame[] => all,
    /**
     * Report the main frame.
     * @returns Main frame.
     */
    mainFrame: (): Frame => mainFrame,
  };
}

describe('SubmitResolveCore.resolveInFrame', () => {
  it('returns none() when the visibility race finds nothing', async (): Promise<void> => {
    const page = makeScreenshotPage();
    const mediator = makeRacingMediator(NOT_FOUND_RESULT);
    const args = buildArgs(page, mediator, 'main');
    const result = await resolveInFrame(args);
    expect(result.has).toBe(false);
  });

  it('returns none() when the required frame is no longer on the page', async (): Promise<void> => {
    // PRE recorded a frame that has since detached with no replacement, so
    // its id resolves to nothing. An id that resolves to nothing can never
    // be proven equal to the frame the race landed in, so the submit is
    // refused rather than clicked in whatever frame happened to answer.
    const goneFrame = makeMockFrame('https://bank.co.il/otp');
    const prePage = makeMockPage([goneFrame]);
    const goneFrameId = computeContextId(goneFrame, prePage);
    const page = makeFramedPage([]);
    const race = makeMainFrameRace(page);
    const mediator = makeRacingMediator(race);
    const args = buildArgs(page, mediator, goneFrameId);
    const result = await resolveInFrame(args);
    expect(result.has).toBe(false);
  });

  it('returns some(target) and logs FOUND when the race lands in the required frame', async (): Promise<void> => {
    // Required frame is 'main' (matches makeScreenshotPage's context).
    // Exercises logFrameMatch + buildSuccessTarget + buildSubmitSelector.
    const page = makeScreenshotPage();
    const race = makeMainFrameRace(page);
    const mediator = makeRacingMediator(race);
    const args = buildArgs(page, mediator, 'main');
    const result = await resolveInFrame(args);
    expect(result.has).toBe(true);
    if (result.has) {
      expect(result.value.contextId).toBe('main');
      expect(result.value.kind).toBe('textContent');
      expect(result.value.candidateValue).toBe('כניסה');
    }
  });

  it('accepts the required frame after it re-attached with a new identity', async (): Promise<void> => {
    // PRE recorded the frame under one identity token; the frame then
    // detached and re-attached, so ACTION sees a new object for the same
    // content. Resolving both ids against the live page still matches.
    const preFrame = makeMockFrame(IFRAME_URL);
    const prePage = makeMockPage([preFrame]);
    const staleFrameId = computeContextId(preFrame, prePage);
    const liveFrame = makeMockFrame(IFRAME_URL);
    const page = makeFramedPage([liveFrame]);
    const mediator = makeRacingMediator({ ...BASE_MAIN_FRAME_RACE, context: liveFrame });
    const args = buildArgs(page, mediator, staleFrameId);
    const result = await resolveInFrame(args);
    expect(result.has).toBe(true);
  });

  it('rejects a submit found in a live sibling of the required frame', async (): Promise<void> => {
    // Both frames serve the same content, so neither can claim the content
    // base; only the identity token separates them. A submit clicked in the
    // wrong one would post the form the user is not looking at.
    const required = makeMockFrame(IFRAME_URL);
    const sibling = makeMockFrame(IFRAME_URL);
    const page = makeFramedPage([required, sibling]);
    const requiredFrameId = computeContextId(required, page);
    const mediator = makeRacingMediator({ ...BASE_MAIN_FRAME_RACE, context: sibling });
    const args = buildArgs(page, mediator, requiredFrameId);
    const result = await resolveInFrame(args);
    expect(result.has).toBe(false);
  });
});
