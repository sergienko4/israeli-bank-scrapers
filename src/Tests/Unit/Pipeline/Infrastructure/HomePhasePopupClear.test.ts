/**
 * HOME.PRE obstruction clearing — regression guard for the Max
 * marketing bottom-sheet.
 *
 * <p>Field evidence (Docker run `29-07-2026_12044893`): the popup
 * interceptor only runs on the phase boundary (`beforePhase`), so its
 * HOME probe fired at 12:05:10 and reported `dismissed:1` (the cookie
 * banner). HOME.PRE discovery then ran for a further 61 s, during
 * which max.co.il rendered a marketing sheet behind a full-page
 * `cdk-overlay-backdrop`. The ACTION force-click at 12:06:11 was
 * therefore dispatched at coordinates owned by the backdrop —
 * Playwright reported `Tier force-1: OK` while `preClickUrl ===
 * postClickUrl` and HOME.FINAL logged `form-ready: false`.
 *
 * <p>The invariant these tests lock: HOME.PRE clears blocking overlays
 * AFTER discovery completes, so the ACTION click lands on the real
 * trigger rather than on a backdrop that appeared mid-discovery.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { HomePhase } from '../../../../Scrapers/Pipeline/Phases/Home/HomePhase.js';
import { WK_CLOSE_POPUP } from '../../../../Scrapers/Pipeline/Registry/WK/SharedWK.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext, makeMockPage } from './MockFactories.js';

/** Bank config stub — HOME only reads `urls.base`. */
const MOCK_CONFIG = {
  urls: { base: 'https://www.max.co.il' },
  balanceKind: 'account' as const,
  authStrategyKind: 'token' as const,
};

/** Race result standing in for a located HOME login trigger. */
const TRIGGER_FOUND: IRaceResult = {
  ...NOT_FOUND_RESULT,
  found: true,
  value: 'כניסה לאיזור האישי',
};

/** Every `resolveAndClick` candidate group seen during a phase run. */
type ClickLog = SelectorCandidate[][];

/**
 * Build a page stub that satisfies the HOME resolver's lifecycle calls.
 *
 * @param pageUrl - URL the page reports before and after navigation.
 * @returns Page stub.
 */
function makeHomePage(pageUrl: string): Page {
  const frame = {
    /**
     * Report the frame URL.
     * @returns Page URL string.
     */
    url: (): string => pageUrl,
  };
  return {
    ...makeMockPage(pageUrl),
    /**
     * Report the main frame.
     * @returns Frame stub.
     */
    mainFrame: (): object => frame,
    /**
     * Report all frames.
     * @returns Single-frame list.
     */
    frames: (): object[] => [frame],
  } as unknown as Page;
}

/**
 * Build a mediator that records every `resolveAndClick` candidate group.
 *
 * @param log - Mutable sink collecting the candidate groups.
 * @param pageUrl - URL the mediator reports.
 * @param hasOverlay - When false, the close-popup group resolves as
 *   not-found so the "nothing to dismiss" branch is genuinely driven.
 * @returns Recording mediator stub.
 */
function makeRecordingMediator(
  log: ClickLog,
  pageUrl: string,
  hasOverlay: boolean,
): IElementMediator {
  return makeMockMediator({
    /**
     * Report the current URL.
     * @returns Page URL string.
     */
    getCurrentUrl: (): string => pageUrl,
    /**
     * Resolve a single visible candidate.
     * @returns The located trigger.
     */
    resolveVisible: () => Promise.resolve(TRIGGER_FOUND),
    /**
     * Resolve every visible candidate — the HOME resolver's probe.
     * @returns Single-element found list.
     */
    resolveAllVisible: () => Promise.resolve([TRIGGER_FOUND]),
    /**
     * Record the candidate group, then report the scripted outcome.
     * @param candidates - Candidate group under test.
     * @returns Successful race result (found only when applicable).
     */
    resolveAndClick: (candidates: readonly SelectorCandidate[]) => {
      log.push([...candidates]);
      const isAbsent = isClosePopupGroup(candidates) && !hasOverlay;
      const clicked = succeed(isAbsent ? NOT_FOUND_RESULT : TRIGGER_FOUND);
      return Promise.resolve(clicked);
    },
    /**
     * Report no scannable hrefs.
     * @returns Empty list.
     */
    collectAllHrefs: () => Promise.resolve([]),
  });
}

/**
 * Assemble a HOME pipeline context wired to a recording mediator.
 *
 * @param log - Mutable sink collecting `resolveAndClick` groups.
 * @param hasOverlay - Whether a dismissible overlay is present.
 * @returns Pipeline context ready for `HomePhase.pre`.
 */
function makeHomeCtx(log: ClickLog, hasOverlay: boolean): IPipelineContext {
  const pageUrl = 'https://www.max.co.il/';
  const browser: IBrowserState = {
    page: makeHomePage(pageUrl),
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  const mediator = makeRecordingMediator(log, pageUrl, hasOverlay);
  return makeMockContext({
    browser: some(browser),
    mediator: some(mediator),
    config: MOCK_CONFIG,
  });
}

/**
 * Whether a recorded group is the shared close-popup well-known group.
 *
 * @param group - One recorded candidate group.
 * @returns True when the group is `WK_CLOSE_POPUP`.
 */
function isClosePopupGroup(group: readonly SelectorCandidate[]): boolean {
  const expected = WK_CLOSE_POPUP as readonly SelectorCandidate[];
  if (group.length !== expected.length) return false;
  return group.every((c, i): boolean => c.value === expected[i].value);
}

describe('HomePhase/PRE obstruction clearing', () => {
  it('dismisses a blocking overlay after discovery completes', async () => {
    const log: ClickLog = [];
    const ctx = makeHomeCtx(log, true);
    await new HomePhase().pre(ctx, ctx);
    const didProbeClosePopup = log.some(isClosePopupGroup);
    expect(didProbeClosePopup).toBe(true);
  });

  it('still probes, and reports PRE success, when no overlay is present', async () => {
    const log: ClickLog = [];
    const ctx = makeHomeCtx(log, false);
    const result = await new HomePhase().pre(ctx, ctx);
    const didProbeClosePopup = log.some(isClosePopupGroup);
    expect(result.success).toBe(true);
    expect(didProbeClosePopup).toBe(true);
  });
});
