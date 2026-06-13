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
import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoverFieldsArgs } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.types.js';
import { resolveInFrame } from '../../../../../Scrapers/Pipeline/Mediator/Login/SubmitResolve/SubmitResolveCore.js';
import type { IResolveInFrameArgs } from '../../../../../Scrapers/Pipeline/Mediator/Login/SubmitResolve/SubmitResolveTypes.js';
import { makeMockMediator } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger, makeScreenshotPage } from '../../Infrastructure/TestHelpers.js';

const CANDIDATE: SelectorCandidate = { kind: 'textContent', value: 'כניסה' };
const CANDIDATES: readonly SelectorCandidate[] = [CANDIDATE];
const ANCHOR = 'form#login';
const STUB_CONFIG: ILoginConfig = {
  loginUrl: 'https://x',
  fields: [],
  submit: [],
  possibleResults: {},
} as unknown as ILoginConfig;

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
  return {
    args: buildDiscoverArgs(page, mediator),
    candidates: CANDIDATES,
    requiredFrameId,
    formAnchor: ANCHOR,
  };
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
  return {
    found: true,
    locator: false,
    candidate: CANDIDATE,
    context: page,
    index: 0,
    value: 'submit',
    identity: false,
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

  it('returns none() and logs WRONG_FRAME when the race lands in the wrong frame', async (): Promise<void> => {
    // Required frame is 'iframe::other' but the race resolves in the
    // main page (contextId = 'main'). Exercises the `if (contextId !==
    // requiredFrameId)` branch + logFrameMismatch + frameMatchExtras.
    const page = makeScreenshotPage();
    const race = makeMainFrameRace(page);
    const mediator = makeRacingMediator(race);
    const args = buildArgs(page, mediator, 'iframe::other');
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
});
