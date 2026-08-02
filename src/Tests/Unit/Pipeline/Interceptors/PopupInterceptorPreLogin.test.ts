/**
 * PopupInterceptor PRE-LOGIN binding + login-UI guard.
 *
 * <p>History. 8.6.1 whitelisted `pre-login` so Max's marketing bottom-sheet
 * (a `mat-bottom-sheet` behind a full-page `cdk-overlay-dark-backdrop`) would
 * stop swallowing PRE-LOGIN clicks. It guarded that by vetoing close controls
 * resolved inside a CHILD IFRAME — enough for CAL, whose login widget lives in
 * `connect.cal-online.co.il/send-otp`, and inert for every bank rendering its
 * login in the MAIN frame. Amex does exactly that, and regressed to
 * `PRE-LOGIN: no password field` between 8.6.0 and 8.6.1.
 *
 * <p>The guard is now the union of two proxies for "this control belongs to
 * the login UI": frame provenance (CAL) OR a visible login form (Amex,
 * Isracard, Hapoalim). Max trips neither, so its backdrop is still cleared.
 *
 * <p>LAYERING — the `widget-frame` veto needs real cross-origin frames, which
 * `setContent` fixture replay cannot reconstruct, so it is covered HERE with a
 * stub frame. The `login-form-visible` veto is additionally covered against
 * real captured markup in `Integration/PreLoginPopupGuard.modeA.test.ts`.
 * Neither layer alone covers both banks.
 *
 * <p>Test Case IDs:
 *   - T-POPUP-1: host-page overlay, no login form visible → dismiss (Max).
 *   - T-POPUP-2 (FIRING): close control inside a login-widget iframe → veto (VisaCal).
 *   - T-POPUP-3 (FIRING): login form already visible → veto (Amex/Isracard).
 *   - T-POPUP-4: `home` / `account-resolve` / `dashboard` keep all-frames dismissal.
 *   - T-POPUP-5: phases outside the whitelist never dismiss.
 */

import type { Frame, Page } from 'playwright-core';

import { createPopupInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/PopupInterceptor.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Stand-in for the main page — identity is all `computeContextId` needs. */
const PAGE = {
  /**
   * Page URL probe.
   * @returns Max host-page URL.
   */
  url: (): string => 'https://www.max.co.il/',
} as unknown as Page;

/** URL the stub mediator reports before and after every dismissal. */
const STUB_URL = 'https://www.max.co.il/';

/** Stand-in for an embedded cross-origin login widget iframe. */
const WIDGET_FRAME = {
  /**
   * Frame URL probe.
   * @returns CAL login-widget URL.
   */
  url: (): string => 'https://connect.cal-online.co.il/send-otp',
  /**
   * Frame name probe (about:blank fallback path).
   * @returns Static frame name.
   */
  name: (): string => 'widget',
} as unknown as Frame;

/** How the stub resolver answers each probe the guard makes. */
interface IScenario {
  /** Frame the close control resolves in, or false when absent. */
  readonly closeContext: Page | Frame | false;
  /** Whether a login form resolves as visible. */
  readonly isLoginFormVisible: boolean;
}

/** Stub mediator plus the observable dismissal counter. */
interface IRecordingMediator {
  readonly mediator: IElementMediator;
  readonly calls: { count: number };
}

/**
 * Decide what one `resolveVisible` call reports. The guard probes the close
 * control first, then the form gates, so the stub answers by call order.
 * @param scenario - Scenario under test.
 * @param callIndex - Zero-based `resolveVisible` invocation number.
 * @returns Race-result shape for that probe.
 */
function answerProbe(scenario: IScenario, callIndex: number): Partial<IRaceResult> {
  if (callIndex === 0) {
    return { found: scenario.closeContext !== false, context: scenario.closeContext };
  }
  return { found: scenario.isLoginFormVisible, context: PAGE };
}

/**
 * Build a stub mediator answering the guard's probes per scenario and
 * recording every dismissal attempt.
 * @param scenario - Scenario under test.
 * @returns Recording mediator bundle.
 */
function makeMediator(scenario: IScenario): IRecordingMediator {
  const calls = { count: 0 };
  const probes = { count: 0 };
  /**
   * Stub visibility race driving the guard's decision.
   * @returns Race result for the current probe index.
   */
  const stubResolveVisible = async (): Promise<Partial<IRaceResult>> => {
    await Promise.resolve();
    const index = probes.count;
    probes.count += 1;
    return answerProbe(scenario, index);
  };
  /**
   * Stub dismissal that records the attempt and reports nothing found.
   * @returns Success procedure reporting no popup found.
   */
  const stubResolveAndClick = async (): Promise<Procedure<Partial<IRaceResult>>> => {
    calls.count += 1;
    await Promise.resolve();
    return succeed({ found: false });
  };
  const mediator = {
    network: {
      /**
       * Endpoint snapshot read for the dismissal delta log.
       * @returns Empty pool.
       */
      getAllEndpoints: (): readonly unknown[] => [],
    },
    resolveVisible: stubResolveVisible,
    resolveAndClick: stubResolveAndClick,
    /**
     * Dismissal never navigates in these scenarios.
     * @returns A stable URL.
     */
    getCurrentUrl: (): string => STUB_URL,
  } as unknown as IElementMediator;
  return { mediator, calls };
}

/**
 * Compose a pipeline context carrying the recording mediator and page.
 * @param mediator - Stub mediator to attach.
 * @returns Context ready for `beforePhase`.
 */
function makeCtx(mediator: IElementMediator): IPipelineContext {
  const base = makeMockContext();
  const browser = { has: true, value: { page: PAGE } };
  return { ...base, browser, mediator: { has: true, value: mediator } } as IPipelineContext;
}

/**
 * Run the interceptor once and report how many dismissals it attempted.
 * @param scenario - Scenario under test.
 * @param phase - Phase about to run.
 * @returns Number of dismissal attempts performed.
 */
async function countDismissals(scenario: IScenario, phase: string): Promise<number> {
  const { mediator, calls } = makeMediator(scenario);
  const interceptor = createPopupInterceptor();
  const ctx = makeCtx(mediator);
  await interceptor.beforePhase(ctx, phase);
  return calls.count;
}

/** Max: host-page marketing overlay, login form still hidden. */
const MAX_OVERLAY: IScenario = { closeContext: PAGE, isLoginFormVisible: false };
/** VisaCal: close control owned by the embedded login widget. */
const CAL_WIDGET: IScenario = { closeContext: WIDGET_FRAME, isLoginFormVisible: false };
/** Amex / Isracard: login form already rendered in the main frame. */
const LOGIN_FORM_UP: IScenario = { closeContext: PAGE, isLoginFormVisible: true };

describe('PopupInterceptor — PRE-LOGIN binding + login-UI guard (T-POPUP)', () => {
  it('T-POPUP-1: dismisses a host-page overlay when no login form is up (Max)', async () => {
    const count = await countDismissals(MAX_OVERLAY, 'pre-login');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('T-POPUP-2 (FIRING): never closes a login-widget iframe control (VisaCal)', async () => {
    const count = await countDismissals(CAL_WIDGET, 'pre-login');
    expect(count).toBe(0);
  });

  it('T-POPUP-3 (FIRING): never dismisses once the login form is visible (Amex)', async () => {
    const count = await countDismissals(LOGIN_FORM_UP, 'pre-login');
    expect(count).toBe(0);
  });

  it.each(['home', 'account-resolve', 'dashboard'])(
    'T-POPUP-4: keeps unguarded all-frames dismissal at %s',
    async phase => {
      const count = await countDismissals(CAL_WIDGET, phase);
      expect(count).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(['init', 'login', 'scrape', 'terminate'])(
    'T-POPUP-5: ignores %s (outside the whitelist)',
    async phase => {
      const count = await countDismissals(MAX_OVERLAY, phase);
      expect(count).toBe(0);
    },
  );
});
