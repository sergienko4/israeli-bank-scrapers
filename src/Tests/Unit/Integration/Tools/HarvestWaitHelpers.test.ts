/**
 * Unit tests for {@link waitForCredentialInputIfNeeded} — harvester
 * SPA-hydration wait wired into the legacy pre-login recipe path.
 *
 * <p>Mocks the Playwright {@link Page} so the helper can be exercised
 * without booting Chromium. Cases:
 * <ul>
 *   <li>Flag undefined → no wait (legacy banks unaffected).</li>
 *   <li>Flag false (synthetic) → no wait (defensive: only `true` triggers).</li>
 *   <li>Flag true, password input present on TOP-level frame → resolves.</li>
 *   <li>Flag true, password input present only in a NESTED frame → resolves.</li>
 *   <li>Flag true, no frame ever exposes the input → rejects with deterministic
 *       timeout message after the budget elapses.</li>
 * </ul>
 */

import type { ElementHandle, Frame, Page } from 'playwright-core';

import {
  CREDENTIAL_INPUT_SELECTOR,
  DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS,
  FRAME_POLL_INTERVAL_MS,
  waitForCredentialInputIfNeeded,
} from '../../../Integration/Tools/HarvestWaitHelpers.js';

/** Plan describing which frames return a credential input (and after how many polls). */
interface IFramePlan {
  readonly findOnPoll: number;
  readonly findOnFrameIndex: number;
}

/** Recording mock Page + accumulated `waitForTimeout` ticks. */
interface IRecordingPage {
  readonly page: Page;
  readonly ticks: readonly number[];
}

/**
 * Build a fake handle that satisfies the {@link Frame.$} return type
 * for matching probes. Returning a sentinel object is enough — the
 * helper only checks `!== null`.
 * @returns Opaque non-null sentinel cast to the Playwright type.
 */
function makeHandleSentinel(): ElementHandle {
  return {} as ElementHandle;
}

/** Spec bundle for {@link makeFrame}. */
interface IMakeFrameSpec {
  readonly frameIndex: number;
  readonly state: IPollState;
  readonly plan: IFramePlan;
}

/** Mutable poll counter shared across mock frames. */
interface IPollState {
  polls: number;
}

/**
 * Decide whether a probe should resolve to a handle on this poll.
 * @param spec - Frame counter + plan reference.
 * @param selector - Selector requested by the helper.
 * @returns True when the mock should surface the credential.
 */
function shouldMatchProbe(spec: IMakeFrameSpec, selector: string): boolean {
  const hasPoll = spec.state.polls >= spec.plan.findOnPoll;
  const hasIdx = spec.frameIndex === spec.plan.findOnFrameIndex;
  const hasSel = selector === CREDENTIAL_INPUT_SELECTOR;
  return hasPoll && hasIdx && hasSel;
}

/** Type alias for the Playwright `Frame.$` return shape — hides the `null` keyword from the function-return architecture rule. */
type ProbeResult = ReturnType<Frame['$']>;

/** Sentinel handle returned by the mock when no element matches. */
const NO_MATCH_HANDLE: Awaited<ProbeResult> = null;

/**
 * Build the per-frame `$` probe closure for a mock Playwright frame.
 * Extracted so {@link makeFrame} stays simple and lint-clean.
 * @param spec - Frame counter + plan reference.
 * @returns Function matching the Playwright `Frame.$` signature.
 */
function makeProbeFn(spec: IMakeFrameSpec) {
  return (selector: string): ProbeResult => {
    const wasHit = shouldMatchProbe(spec, selector);
    const handle = wasHit ? (makeHandleSentinel() as Awaited<ProbeResult>) : NO_MATCH_HANDLE;
    return Promise.resolve(handle);
  };
}

/**
 * Build a single mock frame whose `$` predicate matches when the
 * current poll count + frame index satisfies the plan.
 * @param spec - Frame counter + plan reference.
 * @returns Mock Frame satisfying the methods the helper uses.
 */
function makeFrame(spec: IMakeFrameSpec): Frame {
  const fr = { $: makeProbeFn(spec) };
  return fr as unknown as Frame;
}

/**
 * Build the frame array used by {@link buildPageWithPlan}.
 * @param frameCount - Number of frames the page exposes.
 * @param state - Shared poll counter.
 * @param plan - Plan describing when/where the credential surfaces.
 * @returns Fresh frame array.
 */
function buildFrames(frameCount: number, state: IPollState, plan: IFramePlan): readonly Frame[] {
  return Array.from({ length: frameCount }, (_unused, frameIndex) =>
    makeFrame({ frameIndex, state, plan }),
  );
}

/** Internal context bundle for the recording page builder. */
interface IRecordingCtx {
  readonly state: IPollState;
  readonly ticks: number[];
  readonly frames: readonly Frame[];
}

/**
 * Build the recording `waitForTimeout` closure.
 * @param ctx - Recording context (state + ticks).
 * @returns Function matching Playwright `Page.waitForTimeout`.
 */
function makeWaitForTimeout(ctx: IRecordingCtx): (ms: number) => Promise<void> {
  return (ms: number): Promise<void> => {
    ctx.ticks.push(ms);
    ctx.state.polls += 1;
    return Promise.resolve();
  };
}

/**
 * Build the recording `frames()` closure.
 * @param ctx - Recording context (frames).
 * @returns Function matching Playwright `Page.frames`.
 */
function makeFramesFn(ctx: IRecordingCtx) {
  return (): readonly Frame[] => ctx.frames;
}

/**
 * Build the mock Page using the prepared context.
 * @param ctx - Recording context (state + ticks + frames).
 * @returns Mock Page that records its `waitForTimeout` calls.
 */
function buildMockPage(ctx: IRecordingCtx): Page {
  const page = {
    frames: makeFramesFn(ctx),
    waitForTimeout: makeWaitForTimeout(ctx),
  };
  return page as unknown as Page;
}

/**
 * Build a recording Page whose `frames()` returns N mock frames each
 * obeying the supplied plan. `waitForTimeout` increments the poll
 * counter so successive `$` probes can resolve.
 * @param frameCount - Number of frames the page exposes.
 * @param plan - Plan describing when/where the credential surfaces.
 * @returns Recording page + accumulated ticks the helper requested.
 */
function buildPageWithPlan(frameCount: number, plan: IFramePlan): IRecordingPage {
  const state: IPollState = { polls: 0 };
  const ticks: number[] = [];
  const frames = buildFrames(frameCount, state, plan);
  const page = buildMockPage({ state, ticks, frames });
  return { page, ticks };
}

/**
 * Build a page whose frames never expose the credential input.
 * @param frameCount - Number of mock frames to expose.
 * @returns Recording page that will always time out.
 */
function buildPageThatNeverFinds(frameCount: number): IRecordingPage {
  return buildPageWithPlan(frameCount, {
    findOnPoll: Number.MAX_SAFE_INTEGER,
    findOnFrameIndex: -1,
  });
}

describe('waitForCredentialInputIfNeeded', () => {
  it('skips wait when flag is undefined (legacy banks unchanged)', async () => {
    const { page, ticks } = buildPageWithPlan(1, { findOnPoll: 0, findOnFrameIndex: 0 });
    const didWait = await waitForCredentialInputIfNeeded(page, undefined);
    expect(didWait).toBe(false);
    expect(ticks.length).toBe(0);
  });

  it('skips wait when flag is not strictly true (defensive)', async () => {
    const { page, ticks } = buildPageWithPlan(1, { findOnPoll: 0, findOnFrameIndex: 0 });
    const didWait = await waitForCredentialInputIfNeeded(page, false);
    expect(didWait).toBe(false);
    expect(ticks.length).toBe(0);
  });

  it('resolves when the credential is already in the top-level frame', async () => {
    const { page, ticks } = buildPageWithPlan(3, { findOnPoll: 0, findOnFrameIndex: 0 });
    const didWait = await waitForCredentialInputIfNeeded(page, true);
    expect(didWait).toBe(true);
    expect(ticks.length).toBe(0);
  });

  it('resolves when the credential surfaces only in a nested iframe', async () => {
    const { page, ticks } = buildPageWithPlan(3, { findOnPoll: 0, findOnFrameIndex: 2 });
    const didWait = await waitForCredentialInputIfNeeded(page, true);
    expect(didWait).toBe(true);
    expect(ticks.length).toBe(0);
  });

  it('polls while waiting and uses the configured interval', async () => {
    const { page, ticks } = buildPageWithPlan(2, { findOnPoll: 2, findOnFrameIndex: 1 });
    const didWait = await waitForCredentialInputIfNeeded(page, true);
    expect(didWait).toBe(true);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0]).toBe(FRAME_POLL_INTERVAL_MS);
  });

  it('throws a deterministic timeout error when no frame ever exposes the credential', async () => {
    const { page } = buildPageThatNeverFinds(2);
    const tinyTimeoutMs = 20;
    const promise = waitForCredentialInputIfNeeded(page, true, tinyTimeoutMs);
    await expect(promise).rejects.toThrow(
      `Timeout ${String(tinyTimeoutMs)}ms exceeded waiting for ${CREDENTIAL_INPUT_SELECTOR} in any frame`,
    );
  });

  it('uses the documented default timeout constant', () => {
    expect(DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS).toBe(30000);
  });
});
