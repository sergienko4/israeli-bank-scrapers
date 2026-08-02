/**
 * PopupInterceptor phase whitelist — regression guard for the Amex
 * `PRE-LOGIN: no password field` failure introduced in 8.6.1.
 *
 * <p>History. 8.6.1 added `pre-login` to the whitelist so Max's marketing
 * bottom-sheet (a `mat-bottom-sheet` behind a full-page
 * `cdk-overlay-dark-backdrop`) would stop swallowing PRE-LOGIN clicks. It
 * shipped with a veto that skipped dismissal when the close control
 * resolved inside a CHILD IFRAME — enough for CAL, whose login widget
 * lives in `connect.cal-online.co.il/send-otp`, and inert for every bank
 * rendering its login in the MAIN frame. Amex does exactly that, so on the
 * Amex login page the probe was free to click any control whose accessible
 * name merely CONTAINS `סגירה` / `close` / `ביטול`. Amex was green on
 * 8.6.0 and failed on 8.6.1.
 *
 * <p>Contract locked here: PRE-LOGIN runs on the bank's own login page,
 * where every close-like control belongs to the login UI, so the phase is
 * NOT a dismissal boundary. Max needs a guard keyed on "does this control
 * belong to the login UI", not on which frame it lives in.
 *
 * <p>Test Case IDs:
 *   - T-POPUP-1 (FIRING): zero dismissal attempts at `pre-login`.
 *   - T-POPUP-2/3/4: `home`, `account-resolve`, `dashboard` still dismiss.
 *   - T-POPUP-5: phases outside the whitelist never dismiss.
 */

import { createPopupInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/PopupInterceptor.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Stub mediator plus the observable dismissal counter. */
interface IRecordingMediator {
  readonly mediator: IElementMediator;
  readonly calls: { count: number };
}

/**
 * Build a mediator whose `resolveAndClick` records every dismissal attempt.
 * @returns Recording mediator bundle.
 */
function makeMediator(): IRecordingMediator {
  const calls = { count: 0 };
  /**
   * Records the attempt then reports nothing found, so `dismissPopups`
   * stops after a single pass.
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
    resolveAndClick: stubResolveAndClick,
  } as unknown as IElementMediator;
  return { mediator, calls };
}

/**
 * Run the interceptor once and report how many dismissals it attempted.
 * @param phase - Phase about to run.
 * @returns Number of dismissal attempts performed.
 */
async function countDismissals(phase: string): Promise<number> {
  const { mediator, calls } = makeMediator();
  const interceptor = createPopupInterceptor();
  const base = makeMockContext();
  const ctx = { ...base, mediator: { has: true, value: mediator } } as IPipelineContext;
  await interceptor.beforePhase(ctx, phase);
  return calls.count;
}

describe('PopupInterceptor — phase whitelist (T-POPUP)', () => {
  it('T-POPUP-1 (FIRING): never dismisses at pre-login', async () => {
    const count = await countDismissals('pre-login');
    expect(count).toBe(0);
  });

  it.each(['home', 'account-resolve', 'dashboard'])(
    'T-POPUP-2/3/4: still dismisses at %s',
    async phase => {
      const count = await countDismissals(phase);
      expect(count).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(['init', 'login', 'scrape', 'terminate'])(
    'T-POPUP-5: ignores %s (outside the whitelist)',
    async phase => {
      const count = await countDismissals(phase);
      expect(count).toBe(0);
    },
  );
});
