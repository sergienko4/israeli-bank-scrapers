/**
 * PageReadiness — `waitForDomReady` + `waitForSpaReady` helper unit tests.
 *
 * <p>Test Case IDs:
 *   - PAGE-READY-001…005: `waitForDomReady` contract.
 *   - READY-SPA-001…005: `waitForSpaReady` contract (M4.F2.c / dom-ready-everywhere).
 *
 * <p>All inputs are deterministic stubs — no real Playwright launch.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import waitForDomReady, {
  waitForSpaReady,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/PageReadiness.js';

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

/** Captured call shape for `waitForSpaReady` tests. */
interface IMultiCall {
  readonly state: string;
  readonly timeout: number;
}

/**
 * Build a Playwright target that resolves or rejects PER-STATE so
 * `waitForSpaReady` tests can exercise the combined `load + networkidle`
 * race independently. `resolveFor` controls which lifecycle events resolve;
 * any state outside that set throws to simulate a Playwright timeout.
 *
 * @param resolveFor - Set of lifecycle event names that resolve.
 * @param captured - Sink for the recorded calls.
 * @returns Page-like stub.
 */
function makeMultiStateStub(resolveFor: ReadonlySet<string>, captured: IMultiCall[]): Page {
  /**
   * Records the per-state call and throws when the state isn't in the
   * resolve allowlist (simulates a Playwright timeout).
   *
   * @param state - Lifecycle event name the SUT awaits.
   * @param opts - Playwright options bag carrying the budget.
   * @param opts.timeout - Wait budget in milliseconds.
   * @returns Resolves on allowed states; throws otherwise.
   */
  async function waitForLoadStateStub(state: string, opts: { timeout: number }): Promise<void> {
    captured.push({ state, timeout: opts.timeout });
    await Promise.resolve();
    if (!resolveFor.has(state)) throw new ScraperError(`Timeout for ${state}`);
  }
  return { waitForLoadState: waitForLoadStateStub } as unknown as Page;
}

const RESOLVE_BOTH: ReadonlySet<string> = new Set(['load', 'networkidle']);
const RESOLVE_IDLE: ReadonlySet<string> = new Set(['networkidle']);
const RESOLVE_LOAD: ReadonlySet<string> = new Set(['load']);
const RESOLVE_NONE: ReadonlySet<string> = new Set<string>();

describe('waitForSpaReady — load + networkidle race for SPA hydration', () => {
  it('READY-SPA-001: returns true when BOTH load AND networkidle fire within budget', async () => {
    const captured: IMultiCall[] = [];
    const page = makeMultiStateStub(RESOLVE_BOTH, captured);
    const wasReady = await waitForSpaReady(page, 10_000);
    expect(wasReady).toBe(true);
    const seen = captured.map((c): string => c.state);
    const sorted = [...seen].sort((a, b): number => a.localeCompare(b));
    expect(sorted).toEqual(['load', 'networkidle']);
  });

  it('READY-SPA-002: returns false when load times out (networkidle alone insufficient)', async () => {
    const captured: IMultiCall[] = [];
    const page = makeMultiStateStub(RESOLVE_IDLE, captured);
    const wasReady = await waitForSpaReady(page, 5_000);
    expect(wasReady).toBe(false);
  });

  it('READY-SPA-003: returns false when networkidle times out (load alone insufficient)', async () => {
    const captured: IMultiCall[] = [];
    const page = makeMultiStateStub(RESOLVE_LOAD, captured);
    const wasReady = await waitForSpaReady(page, 5_000);
    expect(wasReady).toBe(false);
  });

  it('READY-SPA-004: forwards budget to BOTH lifecycle calls via the {timeout} option', async () => {
    const captured: IMultiCall[] = [];
    const page = makeMultiStateStub(RESOLVE_BOTH, captured);
    await waitForSpaReady(page, 7_500);
    const didMatch = captured.every((c): boolean => c.timeout === 7_500);
    expect(didMatch).toBe(true);
  });

  it('READY-SPA-005: swallows Playwright rejection — never throws', async () => {
    const captured: IMultiCall[] = [];
    const page = makeMultiStateStub(RESOLVE_NONE, captured);
    const wasReady = await waitForSpaReady(page, 1_000);
    expect(wasReady).toBe(false);
  });
});
