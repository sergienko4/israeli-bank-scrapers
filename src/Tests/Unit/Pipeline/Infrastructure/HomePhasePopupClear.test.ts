/**
 * HOME.PRE is strictly passive — regression guard for the dismissal that
 * 8.6.1 added here and 8.6.0 never had.
 *
 * <p>Rule #20 reserves DOM mutation for ACTION. 8.6.1 inserted a
 * `dismissPopups` at the END of HOME.PRE, i.e. AFTER `triggerTarget` had
 * already been resolved. Closing an overlay at that point can detach or
 * hide the very element ACTION is about to click — on a Wix-hosted
 * homepage the well-known close candidates also match the site's own
 * expanded navigation menu (`aria-label="סגירה,יש לנווט …"`), which is
 * where the login trigger lives. HOME then reports success without ever
 * reaching the login page, and the first hard gate is PRE-LOGIN, which
 * blames itself with "no password field".
 *
 * <p>Obstruction clearing still happens on the phase boundary via
 * {@link createPopupInterceptor}, which runs BEFORE discovery.
 *
 * <p>Test Case IDs:
 *   - T-HOMEPRE-1 (FIRING): HOME.PRE issues zero clicks.
 *   - T-HOMEPRE-2: HOME.PRE still returns the discovered trigger.
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { HomePhase } from '../../../../Scrapers/Pipeline/Phases/Home/HomePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
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

/** What HOME.PRE was observed doing during one run. */
interface IProbeLog {
  /** Candidate groups HOME.PRE tried to click — must stay empty. */
  readonly clicks: ClickLog;
  /** Trigger matches handed to the resolver, in call order. */
  readonly discovered: IRaceResult[];
}

/**
 * Build a HOME context whose mediator records every click attempt and
 * every trigger match discovery consumed.
 * @param probes - Mutable observation log.
 * @returns Pipeline context wired to the recording mediator.
 */
function makeCtx(probes: IProbeLog): IPipelineContext {
  const page = makeMockPage(MOCK_CONFIG.urls.base);
  const browserState: IBrowserState = {
    page,
    context: {} as unknown as IBrowserState['context'],
    cleanups: [],
  };
  const mediator = makeMockMediator({
    /**
     * URL mock.
     * @returns Homepage URL.
     */
    getCurrentUrl: (): string => MOCK_CONFIG.urls.base,
    /**
     * Single-winner probe used by the resolver's prefer-direct step.
     * @returns The located trigger.
     */
    resolveVisible: () => Promise.resolve(TRIGGER_FOUND),
    /**
     * Enumerated trigger matches consumed by HomeResolver.
     * @returns One found trigger.
     */
    resolveAllVisible: () => {
      probes.discovered.push(TRIGGER_FOUND);
      return Promise.resolve([TRIGGER_FOUND]);
    },
    /**
     * Records the candidate group of every click HOME.PRE attempts.
     * @param candidates - Candidate group being clicked.
     * @returns Success reporting nothing found.
     */
    resolveAndClick: (candidates: readonly SelectorCandidate[]) => {
      probes.clicks.push([...candidates]);
      const outcome = succeed(NOT_FOUND_RESULT);
      return Promise.resolve(outcome);
    },
    /**
     * No href fallback needed.
     * @returns Empty list.
     */
    collectAllHrefs: () => Promise.resolve([]),
  });
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
    config: MOCK_CONFIG,
  });
}

/**
 * Fresh observation log for one phase run.
 * @returns Empty click + discovery log.
 */
function newProbeLog(): IProbeLog {
  return { clicks: [], discovered: [] };
}

describe('HomePhase.pre — strictly passive (T-HOMEPRE)', () => {
  it('T-HOMEPRE-1 (FIRING): issues zero clicks', async () => {
    const probes = newProbeLog();
    const ctx = makeCtx(probes);
    await new HomePhase().pre(ctx, ctx);
    expect(probes.clicks).toEqual([]);
  });

  it('T-HOMEPRE-2: succeeds having consumed the discovered trigger', async () => {
    const probes = newProbeLog();
    const ctx = makeCtx(probes);
    const result = await new HomePhase().pre(ctx, ctx);
    const wasOk = isOk(result);
    // Discovery consults `resolveAllVisible` twice — once in
    // `resolveHomeTrigger`, once in `preferDirectEntry` — so assert the
    // content of every match rather than the call count.
    const didDiscover = probes.discovered.length > 0;
    const isEveryMatchTheTrigger = probes.discovered.every((r): boolean => r === TRIGGER_FOUND);
    expect({ wasOk, didDiscover, isEveryMatchTheTrigger }).toEqual({
      wasOk: true,
      didDiscover: true,
      isEveryMatchTheTrigger: true,
    });
  });
});
