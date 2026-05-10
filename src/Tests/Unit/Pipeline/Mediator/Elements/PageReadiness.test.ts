/**
 * PageReadiness — `waitForDomReady` helper unit tests.
 *
 * <p>Test Case IDs:
 *   - PAGE-READY-001: returns true when the listener resolves within budget
 *   - PAGE-READY-002: returns false when the listener throws (timeout)
 *   - PAGE-READY-003: passes the budget through to Playwright as the
 *                     {timeout} option (regression guard for the call shape)
 *   - PAGE-READY-004: works on a Frame target, not only a Page
 *
 * <p>All inputs are deterministic stubs — no real Playwright launch.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import waitForDomReady from '../../../../../Scrapers/Pipeline/Mediator/Elements/PageReadiness.js';

/** Recorded call shape from the stub. */
interface ICapturedCall {
  readonly state: string;
  readonly options: { readonly timeout: number };
}

/**
 * Build a Playwright-like target that resolves or rejects on
 * `waitForLoadState` and records the call arguments.
 *
 * @param shouldResolve - When true, the listener resolves; when false, it rejects.
 * @param captured - Sink for the recorded call arguments.
 * @returns Page-like stub.
 */
function makePageStub(shouldResolve: boolean, captured: ICapturedCall[]): Page {
  return {
    /**
     * Stub lifecycle listener — records the call shape, then either
     * resolves or throws based on the {@link shouldResolve} flag.
     * @param state - Lifecycle event name passed by the caller.
     * @param options - Options bag carrying the {timeout} budget.
     * @param options.timeout - Wait budget in milliseconds.
     * @returns Resolves when shouldResolve is true; throws otherwise.
     */
    waitForLoadState: async (
      state: string,
      options: { readonly timeout: number },
    ): Promise<void> => {
      captured.push({ state, options });
      await Promise.resolve();
      if (!shouldResolve) throw new ScraperError('Timeout 10000ms exceeded');
    },
  } as unknown as Page;
}

/**
 * Build a Frame-like target. Same listener contract as Page.
 *
 * @param shouldResolve - When true, the listener resolves; when false, it rejects.
 * @returns Frame-like stub.
 */
function makeFrameStub(shouldResolve: boolean): Frame {
  return {
    /**
     * Stub lifecycle listener for the Frame variant.
     * @returns Resolves when shouldResolve is true; throws otherwise.
     */
    waitForLoadState: async (): Promise<void> => {
      await Promise.resolve();
      if (!shouldResolve) throw new ScraperError('Timeout exceeded');
    },
  } as unknown as Frame;
}

describe('waitForDomReady — shared cross-phase primitive', () => {
  it('PAGE-READY-001: returns true when the listener resolves within budget', async () => {
    const captured: ICapturedCall[] = [];
    const page = makePageStub(true, captured);
    const wasReady = await waitForDomReady(page, 10_000);
    expect(wasReady).toBe(true);
  });

  it('PAGE-READY-002: returns false when the listener throws (timeout)', async () => {
    const captured: ICapturedCall[] = [];
    const page = makePageStub(false, captured);
    const wasReady = await waitForDomReady(page, 10_000);
    expect(wasReady).toBe(false);
  });

  it('PAGE-READY-003: forwards the budget to Playwright via the {timeout} option', async () => {
    const captured: ICapturedCall[] = [];
    const page = makePageStub(true, captured);
    await waitForDomReady(page, 7_500);
    expect(captured).toHaveLength(1);
    expect(captured[0].state).toBe('domcontentloaded');
    expect(captured[0].options.timeout).toBe(7_500);
  });

  it('PAGE-READY-004: works on a Frame target (not only Page)', async () => {
    const frame = makeFrameStub(true);
    const wasReady = await waitForDomReady(frame, 5_000);
    expect(wasReady).toBe(true);
  });

  it('PAGE-READY-005: non-fatal contract — caller decides on timeout', async () => {
    const frame = makeFrameStub(false);
    const wasReady = await waitForDomReady(frame, 1_000);
    expect(wasReady).toBe(false);
  });
});
