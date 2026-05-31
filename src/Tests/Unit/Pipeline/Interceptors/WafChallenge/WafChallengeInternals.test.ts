/**
 * Unit tests for WafChallengeInternals — poller / cooldown / dispatch helpers.
 *
 * <p>Drives the helpers directly with mock Page/logger/state so we can assert
 * the guard-and-bookkeeping flow without spinning up a browser:
 *   - makeState() returns empty Weak collections
 *   - isDisabled() reads WAF_INTERCEPTOR_DISABLED env var
 *   - isInCooldown() compares lastSolveAtMs against the cool-down window
 *   - tickOnce() guards re-entrance + cool-down + no-challenge cases
 *   - attachPoller() is idempotent and starts the polling timer
 *   - detachPoller() clears the timer and removes the entry from state
 */

import type { Page } from 'playwright-core';

import { WAF_INTERCEPTOR_DISABLED_ENV } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeConfig.js';
import {
  attachPoller,
  buildIntervalHandler,
  detachPoller,
  isDisabled,
  isInCooldown,
  makeState,
  runAfterPipeline,
  runBeforePhase,
  runSolverGuarded,
  runSolverSafe,
  tickOnce,
  wirePageClose,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeInternals.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBrowserState } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { clearDisableEnv, makeLogger, makePageStub } from './WafChallengeTestHelpers.js';

describe('WafChallengeInternals.makeState', () => {
  it('returns empty Weak collections', () => {
    const s = makeState();
    const dummyPage = {} as unknown as Page;
    const hasAttached = s.attached.has(dummyPage);
    const hasSolving = s.solving.has(dummyPage);
    const timerGet = s.timers.get(dummyPage);
    const lastGet = s.lastSolveAtMs.get(dummyPage);
    expect(hasAttached).toBe(false);
    expect(hasSolving).toBe(false);
    expect(timerGet).toBeUndefined();
    expect(lastGet).toBeUndefined();
  });
});

describe('WafChallengeInternals.isDisabled', () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[WAF_INTERCEPTOR_DISABLED_ENV];
  });

  afterEach(() => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = originalValue ?? '';
  });

  it('returns false when env var is unset', () => {
    clearDisableEnv();
    const result = isDisabled();
    expect(result).toBe(false);
  });

  it('returns true when env var is "1"', () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = '1';
    const result = isDisabled();
    expect(result).toBe(true);
  });

  it('returns true when env var is "true" (any case)', () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = 'TRUE';
    const result = isDisabled();
    expect(result).toBe(true);
  });

  it('returns false for any other truthy value (strict allowlist "yes")', () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = 'yes';
    const yesResult = isDisabled();
    expect(yesResult).toBe(false);
  });

  it('returns false for "on" (strict allowlist)', () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = 'on';
    const onResult = isDisabled();
    expect(onResult).toBe(false);
  });
});

describe('WafChallengeInternals.isInCooldown', () => {
  it('returns false when page has never been solved', () => {
    const state = makeState();
    const page = makePageStub();
    const isCooling = isInCooldown(state, page);
    expect(isCooling).toBe(false);
  });

  it('returns true immediately after a solve timestamp is recorded', () => {
    const state = makeState();
    const page = makePageStub();
    const now = Date.now();
    state.lastSolveAtMs.set(page, now);
    const isCooling = isInCooldown(state, page);
    expect(isCooling).toBe(true);
  });

  it('returns false once enough time has elapsed beyond the cool-down', () => {
    const state = makeState();
    const page = makePageStub();
    const longAgo = Date.now() - 60_000;
    state.lastSolveAtMs.set(page, longAgo);
    const isCooling = isInCooldown(state, page);
    expect(isCooling).toBe(false);
  });
});

describe('WafChallengeInternals.tickOnce', () => {
  it('returns false when already solving', async () => {
    const state = makeState();
    const page = makePageStub();
    state.solving.add(page);
    const args = { page, logger: makeLogger(), state };
    const did = await tickOnce(args);
    expect(did).toBe(false);
  });

  it('returns false when in cooldown', async () => {
    const state = makeState();
    const page = makePageStub();
    const now = Date.now();
    state.lastSolveAtMs.set(page, now);
    const args = { page, logger: makeLogger(), state };
    const did = await tickOnce(args);
    expect(did).toBe(false);
  });

  it('returns false when no challenge is detected', async () => {
    const state = makeState();
    const page = makePageStub([]);
    const args = { page, logger: makeLogger(), state };
    const did = await tickOnce(args);
    expect(did).toBe(false);
  });
});

describe('WafChallengeInternals.attachPoller and detachPoller', () => {
  it('attach is idempotent: second call returns false', () => {
    const state = makeState();
    const page = makePageStub();
    const args = { page, logger: makeLogger(), state };
    const first = attachPoller(args);
    const second = attachPoller(args);
    detachPoller(page, state);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('attach registers a timer; detach clears it', () => {
    const state = makeState();
    const page = makePageStub();
    const args = { page, logger: makeLogger(), state };
    attachPoller(args);
    const timerBefore = state.timers.get(page);
    const didDetach = detachPoller(page, state);
    const timerAfter = state.timers.get(page);
    expect(timerBefore).toBeDefined();
    expect(didDetach).toBe(true);
    expect(timerAfter).toBeUndefined();
  });

  it('detach returns false when no timer is registered', () => {
    const state = makeState();
    const page = makePageStub();
    const did = detachPoller(page, state);
    expect(did).toBe(false);
  });
});

describe('WafChallengeInternals.runBeforePhase', () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[WAF_INTERCEPTOR_DISABLED_ENV];
  });

  afterEach(() => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = originalValue ?? '';
  });

  it('returns succeed when interceptor is disabled by env', () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = '1';
    const state = makeState();
    const ctx = makeMockContext();
    const result = runBeforePhase(ctx, state);
    expect(result.success).toBe(true);
  });

  it('returns succeed (no-op) when browser is not present', () => {
    clearDisableEnv();
    const state = makeState();
    const ctx = makeMockContext();
    const result = runBeforePhase(ctx, state);
    const dummy = {} as Page;
    const isStillUnattached = !state.attached.has(dummy);
    expect(result.success).toBe(true);
    expect(isStillUnattached).toBe(true);
  });

  it('attaches when browser is present and a real page is on the context', () => {
    clearDisableEnv();
    const state = makeState();
    const page = makePageStub();
    const browserState = {
      page,
      context: {} as IBrowserState['context'],
      cleanups: [],
    } as IBrowserState;
    const browser: Option<IBrowserState> = some(browserState);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, browser };
    const result = runBeforePhase(ctx, state);
    const hasAttached = state.attached.has(page);
    expect(result.success).toBe(true);
    expect(hasAttached).toBe(true);
    detachPoller(page, state);
  });
});

describe('WafChallengeInternals.runAfterPipeline', () => {
  it('returns succeed(true) when no browser is present', () => {
    const state = makeState();
    const ctx = makeMockContext();
    const result = runAfterPipeline(ctx, state);
    expect(result.success).toBe(true);
  });

  it('detaches the poller when browser is present', () => {
    const state = makeState();
    const page = makePageStub();
    const browserState = {
      page,
      context: {} as IBrowserState['context'],
      cleanups: [],
    } as IBrowserState;
    const browser: Option<IBrowserState> = some(browserState);
    const baseCtx = makeMockContext();
    const ctx = { ...baseCtx, browser };
    const args = { page, logger: makeLogger(), state };
    attachPoller(args);
    const hasTimerBefore = state.timers.get(page) !== undefined;
    runAfterPipeline(ctx, state);
    const hasTimerAfter = state.timers.get(page) !== undefined;
    expect(hasTimerBefore).toBe(true);
    expect(hasTimerAfter).toBe(false);
  });
});

describe('WafChallengeInternals.runSolverSafe and runSolverGuarded', () => {
  it('runSolverSafe returns DidSolve(false) when the solver throws', async () => {
    const state = makeState();
    const page = makePageStub();
    const frame = {} as unknown as Parameters<typeof runSolverSafe>[0]['frame'];
    const tick = { page, logger: makeLogger(), state };
    const dispatch = { tick, kind: 'hcaptcha-checkbox' as const, frame };
    const result = await runSolverSafe(dispatch);
    expect(result).toBe(false);
  });

  it('runSolverGuarded marks solving + records cooldown timestamp', async () => {
    const state = makeState();
    const page = makePageStub();
    const frame = {} as unknown as Parameters<typeof runSolverGuarded>[0]['frame'];
    const tick = { page, logger: makeLogger(), state };
    const dispatch = { tick, kind: 'hcaptcha-checkbox' as const, frame };
    await runSolverGuarded(dispatch);
    const lastSolveAt = state.lastSolveAtMs.get(page);
    const isStillSolving = state.solving.has(page);
    expect(lastSolveAt).toBeGreaterThan(0);
    expect(isStillSolving).toBe(false);
  });
});

describe('WafChallengeInternals.buildIntervalHandler and wirePageClose', () => {
  it('buildIntervalHandler returns a sync function that invokes tickOnce', () => {
    const state = makeState();
    const page = makePageStub();
    const args = { page, logger: makeLogger(), state };
    const handler = buildIntervalHandler(args);
    const handlerKind = typeof handler;
    const didReturn = handler();
    expect(handlerKind).toBe('function');
    expect(didReturn).toBe(true);
  });

  it('wirePageClose registers the close listener and returns true', () => {
    const calls: string[] = [];
    const captured: { handler?: () => unknown } = {};
    interface IClosePageStub {
      readonly on: (event: string, handler: () => unknown) => IClosePageStub;
    }
    const fakePage: IClosePageStub = {
      /**
       * Mock on() — captures the registered handler for later invocation.
       * @param event - The event name (must be "close").
       * @param handler - The handler being registered.
       * @returns Self for chaining.
       */
      on: (event: string, handler: () => unknown): IClosePageStub => {
        calls.push(event);
        captured.handler = handler;
        return fakePage;
      },
    };
    const page = fakePage as unknown as Page;
    const state = makeState();
    const args = { page, logger: makeLogger(), state };
    const wasWired = wirePageClose(args);
    expect(wasWired).toBe(true);
    expect(calls).toEqual(['close']);
    const handler = captured.handler;
    if (handler === undefined) throw new TypeError('handler not captured');
    const handlerResult = handler();
    expect(handlerResult).toBe(false);
  });
});
