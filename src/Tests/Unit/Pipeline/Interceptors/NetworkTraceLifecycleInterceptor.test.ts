/**
 * Coverage for `NetworkTraceLifecycleInterceptor` — the idempotent
 * gate that flips `INetworkDiscovery.setCollectionActive` based on
 * the boundary phase index. Pre-boundary phases must DEACTIVATE the
 * recorder; post-boundary phases must ACTIVATE it. Frozen / mediator-
 * less contexts must short-circuit cleanly.
 */

import { createNetworkTraceLifecycleInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/NetworkTraceLifecycleInterceptor.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

const PHASE_NAMES: readonly string[] = [
  'init',
  'home',
  'pre-login',
  'login',
  'otp-trigger',
  'otp-fill',
  'dashboard',
  'scrape',
  'terminate',
];

/**
 * Build a context whose mediator records `setCollectionActive` calls.
 * @returns Context + the captured-call accessor.
 */
function makeRecordingCtx(): {
  ctx: ReturnType<typeof makeMockContext>;
  getCalls: () => readonly boolean[];
} {
  const calls: boolean[] = [];
  const baseCtx = makeMockContext();
  const ctx = {
    ...baseCtx,
    mediator: {
      has: true,
      value: {
        network: {
          /**
           * Record the recording-state value for assertion.
           * @param active - Desired recording state.
           * @returns True.
           */
          setCollectionActive: (active: boolean): true => {
            calls.push(active);
            return true;
          },
          /**
           * No-op deferred-watcher attach in this test surface.
           * @returns True.
           */
          attachAuthFailureWatcher: (): true => true,
        },
      },
    },
  } as unknown as ReturnType<typeof makeMockContext>;
  /**
   * Read the captured calls — exposed as a closure to keep the test
   * assertions inline-style.
   * @returns Recorded calls in chronological order.
   */
  const getCalls = (): readonly boolean[] => calls;
  return { ctx, getCalls };
}

describe('createNetworkTraceLifecycleInterceptor', () => {
  it('exposes the canonical interceptor name', () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'login');
    expect(inst.name).toBe('network-trace-lifecycle');
  });

  it('short-circuits when ctx.mediator is absent', async () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'login');
    const ctx = makeMockContext();
    const result = await inst.beforePhase(ctx, 'dashboard');
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
  });

  it('keeps recording OFF for pre-boundary phases (login boundary)', async () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'login');
    const recording = makeRecordingCtx();
    await inst.beforePhase(recording.ctx, 'home');
    await inst.beforePhase(recording.ctx, 'login');
    const calls = recording.getCalls();
    expect(calls).toEqual([false, false]);
  });

  it('flips recording ON once nextPhase passes the login boundary', async () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'login');
    const recording = makeRecordingCtx();
    await inst.beforePhase(recording.ctx, 'dashboard');
    const calls = recording.getCalls();
    expect(calls).toEqual([true]);
  });

  it('treats otp-fill boundary correctly (OTP banks)', async () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'otp-fill');
    const recording = makeRecordingCtx();
    await inst.beforePhase(recording.ctx, 'login');
    await inst.beforePhase(recording.ctx, 'otp-trigger');
    await inst.beforePhase(recording.ctx, 'otp-fill');
    await inst.beforePhase(recording.ctx, 'dashboard');
    const calls = recording.getCalls();
    expect(calls).toEqual([false, false, false, true]);
  });

  it('keeps recording ON for legacy when boundary phase is unknown', async () => {
    const inst = createNetworkTraceLifecycleInterceptor(PHASE_NAMES, 'unknown');
    const recording = makeRecordingCtx();
    await inst.beforePhase(recording.ctx, 'init');
    await inst.beforePhase(recording.ctx, 'dashboard');
    const calls = recording.getCalls();
    expect(calls).toEqual([true, true]);
  });
});
