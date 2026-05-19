/**
 * Phase 7d — proves the PopupInterceptor whitelist now includes
 * `account-resolve`. Without this entry, a modal that lands during
 * the post-login wait window would block the SPA from firing the
 * `account/init` request and ACCOUNT-RESOLVE would time out empty.
 *
 * Contract:
 *   - beforePhase('account-resolve', ctx) → calls
 *     mediator.resolveAndClick(WK_CLOSE_POPUP) at least once.
 *   - beforePhase('init', ctx) → does NOT call resolveAndClick
 *     (init is not in the whitelist).
 */

import { createPopupInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/PopupInterceptor.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** Outcome of one click probe — used in place of `void` returns. */
interface IClickProbeOutcome {
  readonly handled: boolean;
}

/** Bundled stub mediator + observable call counter. */
interface IRecordingMediator {
  readonly mediator: IElementMediator;
  readonly calls: { count: number };
}

/**
 * Builds a stub mediator that records every `resolveAndClick` call
 * and returns the supplied result. Lets each test count interactions
 * without depending on the real WK_CLOSE_POPUP signal source.
 * @param hasFoundPopup - Stub return value's `value.found` flag.
 * @returns Tuple of (mediator, calls counter).
 */
function makeRecordingMediator(hasFoundPopup: boolean): IRecordingMediator {
  const calls = { count: 0 };
  /**
   * Stub click that increments the call counter and returns a
   * Procedure-shaped success matching the resolveAndClick contract.
   * @returns Async success procedure.
   */
  const stubResolveAndClick = async (): Promise<Procedure<{ found: boolean; value: string }>> => {
    calls.count += 1;
    await Promise.resolve();
    return succeed({ found: hasFoundPopup, value: 'fake-popup-text' });
  };
  /**
   * Stub the dismissal `await` chain by resolving immediately.
   * @returns No-op outcome.
   */
  const stubWaitForNetworkIdle = async (): Promise<IClickProbeOutcome> => {
    await Promise.resolve();
    return { handled: false };
  };
  const mediator: IElementMediator = {
    network: {
      /**
       * Stub for the endpoint snapshot the interceptor reads to log
       * a delta after dismissal.
       * @returns Empty pool.
       */
      getAllEndpoints: (): readonly unknown[] => [],
    },
    resolveAndClick: stubResolveAndClick,
    waitForNetworkIdle: stubWaitForNetworkIdle,
  } as unknown as IElementMediator;
  return { mediator, calls };
}

describe('PopupInterceptor — Phase 7d account-resolve binding', () => {
  it('beforePhase("account-resolve") calls resolveAndClick at least once', async () => {
    const { mediator, calls } = makeRecordingMediator(false);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, mediator: { has: true, value: mediator } };
    const interceptor = createPopupInterceptor();
    const handler = interceptor.beforePhase.bind(interceptor);
    const handlerResult = await handler(ctx, 'account-resolve');
    const wasOk = isOk(handlerResult);
    expect(wasOk).toBe(true);
    expect(calls.count).toBeGreaterThanOrEqual(1);
  });

  it('beforePhase("home") no longer triggers (removed 2026-05-19 to break the silent-window asymmetry that triggered Hapoalim hCaptcha)', async () => {
    const { mediator, calls } = makeRecordingMediator(false);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, mediator: { has: true, value: mediator } };
    const interceptor = createPopupInterceptor();
    const handler = interceptor.beforePhase.bind(interceptor);
    await handler(ctx, 'home');
    expect(calls.count).toBe(0);
  });

  it('beforePhase("dashboard") still triggers (existing whitelist entry preserved)', async () => {
    const { mediator, calls } = makeRecordingMediator(false);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, mediator: { has: true, value: mediator } };
    const interceptor = createPopupInterceptor();
    const handler = interceptor.beforePhase.bind(interceptor);
    await handler(ctx, 'dashboard');
    expect(calls.count).toBeGreaterThanOrEqual(1);
  });

  it('beforePhase("init") does NOT trigger (init not in whitelist)', async () => {
    const { mediator, calls } = makeRecordingMediator(false);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, mediator: { has: true, value: mediator } };
    const interceptor = createPopupInterceptor();
    const handler = interceptor.beforePhase.bind(interceptor);
    await handler(ctx, 'init');
    expect(calls.count).toBe(0);
  });

  it('beforePhase("scrape") does NOT trigger (scrape not in whitelist)', async () => {
    const { mediator, calls } = makeRecordingMediator(false);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, mediator: { has: true, value: mediator } };
    const interceptor = createPopupInterceptor();
    const handler = interceptor.beforePhase.bind(interceptor);
    await handler(ctx, 'scrape');
    expect(calls.count).toBe(0);
  });
});
