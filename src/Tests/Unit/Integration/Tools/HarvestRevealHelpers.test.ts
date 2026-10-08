/**
 * Unit tests for the harvester's visible-text click helpers —
 * {@link clickRevealAnyFrame} (frame-aware poll) and
 * {@link clickWithFallback} (normal → force → dispatch cascade).
 *
 * <p>Mocks the Playwright {@link Page} / {@link Frame} / {@link Locator}
 * so the helpers run without a browser. Cases:
 * <ul>
 *   <li>Normal click succeeds → no further tier.</li>
 *   <li>Normal click times out on a VISIBLE target → forced click.</li>
 *   <li>Forced mouse click also hangs → dispatched DOM `click` event.</li>
 *   <li>Normal click times out on a HIDDEN target → never forced; the poll
 *       times out with the deterministic message.</li>
 *   <li>Every tier fails → `clickWithFallback` reports false.</li>
 *   <li>Frames without a match are skipped.</li>
 * </ul>
 */

import { jest } from '@jest/globals';
import type { Frame, Locator, Page } from 'playwright-core';

import {
  clickRevealAnyFrame,
  clickWithFallback,
} from '../../../Integration/Tools/HarvestRevealHelpers.js';

/** Options the helper passes to `Locator.click`. */
type ClickOpts = Parameters<Locator['click']>[0];

/** Click tier the helper attempted, in call order. */
type ClickTier = 'normal' | 'force' | 'dispatch';

/** Behaviour of one mock frame's reveal target. */
interface ITargetPlan {
  readonly count: number;
  readonly isVisible: boolean;
  readonly okTiers: readonly ClickTier[];
}

/** Mock target plus the tiers it received, in call order. */
interface IMockTarget {
  readonly target: Locator;
  readonly tiers: readonly ClickTier[];
}

/** Mock frame plus the tiers its target received, in call order. */
interface IMockFrame {
  readonly frame: Frame;
  readonly tiers: readonly ClickTier[];
}

/** Text the tests reveal. */
const REVEAL_TEXT = 'כניסה לחשבון';

/** Short poll budget: success paths click on the first poll; failures time out fast. */
const SHORT_TIMEOUT_MS = 20;

/** Error Playwright raises when a click never completes. */
const CLICK_TIMEOUT = new Error('locator.click: Timeout 5000ms exceeded');

/**
 * Map Playwright click options to the tier they represent.
 * @param opts - Received click options.
 * @returns `force` for a forced click, else `normal`.
 */
function clickTier(opts: ClickOpts): ClickTier {
  if (opts?.force === true) return 'force';
  return 'normal';
}

/**
 * Record a tier and settle it per the plan.
 * @param plan - Target behaviour.
 * @param tiers - Sink for attempted tiers.
 * @param tier - Tier being attempted.
 * @returns Resolves when the plan lets the tier succeed, else rejects.
 */
function settle(plan: ITargetPlan, tiers: ClickTier[], tier: ClickTier): Promise<void> {
  tiers.push(tier);
  if (plan.okTiers.includes(tier)) return Promise.resolve();
  return Promise.reject(CLICK_TIMEOUT);
}

/**
 * Build the recording `Locator.click`.
 * @param plan - Target behaviour.
 * @param tiers - Sink for attempted tiers.
 * @returns Function matching Playwright `Locator.click`.
 */
function makeClick(plan: ITargetPlan, tiers: ClickTier[]): (opts: ClickOpts) => Promise<void> {
  return (opts: ClickOpts): Promise<void> => {
    const tier = clickTier(opts);
    return settle(plan, tiers, tier);
  };
}

/**
 * Build the recording `Locator.dispatchEvent`.
 * @param plan - Target behaviour.
 * @param tiers - Sink for attempted tiers.
 * @returns Function matching Playwright `Locator.dispatchEvent`.
 */
function makeDispatch(plan: ITargetPlan, tiers: ClickTier[]): () => Promise<void> {
  return (): Promise<void> => settle(plan, tiers, 'dispatch');
}

/**
 * Build a mock target locator that follows the plan.
 * @param plan - Target behaviour.
 * @returns Target mock plus its recorded tiers.
 */
function makeTarget(plan: ITargetPlan): IMockTarget {
  const tiers: ClickTier[] = [];
  const click = makeClick(plan, tiers);
  const dispatchEvent = makeDispatch(plan, tiers);
  const count = jest.fn().mockResolvedValue(plan.count);
  const isVisible = jest.fn().mockResolvedValue(plan.isVisible);
  const target = { count, isVisible, click, dispatchEvent } as unknown as Locator;
  return { target, tiers };
}

/**
 * Build a mock frame whose `getByText().first()` follows the plan.
 * @param plan - Target behaviour.
 * @returns Frame mock plus its target's recorded tiers.
 */
function makeFrame(plan: ITargetPlan): IMockFrame {
  const mock = makeTarget(plan);
  const locator = { first: jest.fn().mockReturnValue(mock.target) };
  const frame = { getByText: jest.fn().mockReturnValue(locator) } as unknown as Frame;
  return { frame, tiers: mock.tiers };
}

/**
 * Build a mock page over the given frames; `waitForTimeout` resolves at once.
 * @param frames - Frames returned by `page.frames()`.
 * @returns Page mock.
 */
function makePage(frames: readonly Frame[]): Page {
  const framesFn = jest.fn().mockReturnValue(frames);
  const waitForTimeout = jest.fn().mockResolvedValue(undefined);
  return { frames: framesFn, waitForTimeout } as unknown as Page;
}

describe('clickRevealAnyFrame', () => {
  it('uses the normal click when it completes', async () => {
    const mock = makeFrame({ count: 1, isVisible: true, okTiers: ['normal'] });
    const page = makePage([mock.frame]);
    const isClicked = await clickRevealAnyFrame(page, REVEAL_TEXT, SHORT_TIMEOUT_MS);
    expect(isClicked).toBe(true);
    expect(mock.tiers).toEqual(['normal']);
  });

  it('forces the click when a visible target never completes a normal click', async () => {
    const mock = makeFrame({ count: 1, isVisible: true, okTiers: ['force'] });
    const page = makePage([mock.frame]);
    const isClicked = await clickRevealAnyFrame(page, REVEAL_TEXT, SHORT_TIMEOUT_MS);
    expect(isClicked).toBe(true);
    expect(mock.tiers).toEqual(['normal', 'force']);
  });

  it('dispatches a DOM click when the forced mouse click also hangs', async () => {
    const mock = makeFrame({ count: 1, isVisible: true, okTiers: ['dispatch'] });
    const page = makePage([mock.frame]);
    const isClicked = await clickRevealAnyFrame(page, REVEAL_TEXT, SHORT_TIMEOUT_MS);
    expect(isClicked).toBe(true);
    expect(mock.tiers).toEqual(['normal', 'force', 'dispatch']);
  });

  it('never forces a hidden target and times out deterministically', async () => {
    const mock = makeFrame({ count: 1, isVisible: false, okTiers: ['force', 'dispatch'] });
    const page = makePage([mock.frame]);
    const run = clickRevealAnyFrame(page, REVEAL_TEXT, SHORT_TIMEOUT_MS);
    await expect(run).rejects.toThrow(`waiting for visible text "${REVEAL_TEXT}"`);
    expect(mock.tiers).not.toContain('force');
    expect(mock.tiers).not.toContain('dispatch');
  });

  it('skips frames without a match and clicks in the next frame', async () => {
    const empty = makeFrame({ count: 0, isVisible: true, okTiers: ['normal'] });
    const hit = makeFrame({ count: 1, isVisible: true, okTiers: ['normal'] });
    const page = makePage([empty.frame, hit.frame]);
    const isClicked = await clickRevealAnyFrame(page, REVEAL_TEXT, SHORT_TIMEOUT_MS);
    expect(isClicked).toBe(true);
    expect(empty.tiers).toHaveLength(0);
    expect(hit.tiers).toEqual(['normal']);
  });
});

describe('clickWithFallback', () => {
  it('reports false after every tier fails on a visible target', async () => {
    const mock = makeTarget({ count: 1, isVisible: true, okTiers: [] });
    const isClicked = await clickWithFallback(mock.target);
    expect(isClicked).toBe(false);
    expect(mock.tiers).toEqual(['normal', 'force', 'dispatch']);
  });
});
