/**
 * PRE-LOGIN popup dismissal — binding + embedded-widget safety guard.
 *
 * Evidence (Docker E2E-real, 2026-07-29):
 *   - Max renders a `mat-bottom-sheet` marketing popup behind a full-page
 *     `cdk-overlay-dark-backdrop` AFTER the HOME probe has already fired.
 *     With `pre-login` outside the whitelist the backdrop intercepts every
 *     click and PRE-LOGIN dies on a 15s click timeout. Its close control
 *     resolves in the MAIN frame (`ariaLabel:close @ https://www.max.co.il/`).
 *   - Naively whitelisting `pre-login` regressed VisaCal from PASS to FAIL:
 *     the probe resolved `<button class="x-close" aria-label="סגירה">` inside
 *     the CHILD IFRAME `connect.cal-online.co.il/send-otp` and closed CAL's
 *     OWN login widget, producing `PRE-LOGIN: no password field`.
 *
 * Contract encoded here: at `pre-login`, dismiss only close controls that
 * belong to the HOST page. A control rendered inside an embedded widget
 * iframe is part of the login UI, never an obstruction.
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

/** Stub mediator plus the observable dismissal counter. */
interface IRecordingMediator {
  readonly mediator: IElementMediator;
  readonly calls: { count: number };
}

/** Stand-in for the main page — identity is all `computeContextId` needs. */
const PAGE = {
  /**
   * Page URL probe.
   * @returns Max host-page URL.
   */
  url: (): string => 'https://www.max.co.il/',
} as unknown as Page;

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

/**
 * Build a stub mediator whose `resolveVisible` reports where the close
 * control lives, and whose `resolveAndClick` records dismissal attempts.
 * @param context - Frame the close control resolves in, or false when absent.
 * @returns Recording mediator bundle.
 */
function makeMediator(context: Page | Frame | false): IRecordingMediator {
  const calls = { count: 0 };
  /**
   * Stub provenance probe driving the embedded-widget veto.
   * @returns Race result carrying the configured context.
   */
  const stubResolveVisible = async (): Promise<Partial<IRaceResult>> => {
    await Promise.resolve();
    return { found: context !== false, context };
  };
  /**
   * Stub dismissal that records every attempt.
   * @returns Success procedure reporting no popup found.
   */
  const stubResolveAndClick = async (): Promise<Procedure<Partial<IRaceResult>>> => {
    calls.count += 1;
    await Promise.resolve();
    return succeed({ found: false });
  };
  /**
   * Stub settle wait used after a dismissal.
   * @returns Always true.
   */
  const stubWaitForNetworkIdle = async (): Promise<boolean> => {
    await Promise.resolve();
    return true;
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
    waitForNetworkIdle: stubWaitForNetworkIdle,
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
 * @param context - Frame the close control resolves in, or false when absent.
 * @param phase - Phase about to run.
 * @returns Number of dismissal attempts performed.
 */
async function countDismissals(context: Page | Frame | false, phase: string): Promise<number> {
  const { mediator, calls } = makeMediator(context);
  const interceptor = createPopupInterceptor();
  const ctx = makeCtx(mediator);
  await interceptor.beforePhase(ctx, phase);
  return calls.count;
}

describe('PopupInterceptor — PRE-LOGIN binding + embedded-widget guard', () => {
  it('dismisses a host-page overlay at pre-login (Max marketing sheet)', async () => {
    const count = await countDismissals(PAGE, 'pre-login');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('does NOT close a control owned by a login widget iframe (VisaCal)', async () => {
    const count = await countDismissals(WIDGET_FRAME, 'pre-login');
    expect(count).toBe(0);
  });

  it('still probes at pre-login when no close control resolves', async () => {
    const count = await countDismissals(false, 'pre-login');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('keeps all-frames dismissal at account-resolve (VisaCal promo popup)', async () => {
    const count = await countDismissals(WIDGET_FRAME, 'account-resolve');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('still ignores phases outside the whitelist', async () => {
    const count = await countDismissals(PAGE, 'scrape');
    expect(count).toBe(0);
  });
});
