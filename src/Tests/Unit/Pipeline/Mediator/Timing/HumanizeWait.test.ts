/**
 * Unit tests for `buildHumanizeWait` — the mouse-jitter settle used by
 * `PipelineReducer.phaseSettle` for the INIT / HOME / LOGIN whitelist.
 *
 * Mocks a minimal `Page` that records every `mouse.move` call so each
 * test verifies the jitter contract:
 *
 *   1. The settle resolves inside the requested budget.
 *   2. Multiple jitter ticks fire for a 4 s budget.
 *   3. The final mouse position is `(0, 0)` — cursor parks at top-left.
 *   4. A failing `mouse.move` does not throw — settle still resolves.
 *   5. `mouse.move` is never called with negative pixel coordinates.
 *   6. A budget shorter than one tick still parks the cursor.
 */

import buildHumanizeWait from '../../../../../Scrapers/Pipeline/Mediator/Timing/HumanizeWait.js';
import {
  HUMANIZE_END_X,
  HUMANIZE_END_Y,
  HUMANIZE_TICK_MS,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingConfig.js';

/** Captured mouse-move coordinate pair. */
interface IRecordedMove {
  readonly x: number;
  readonly y: number;
}

/**
 * Viewport shape — alias hides the `| null` union behind a type
 * reference so the architecture `no-restricted-syntax` rule (no
 * `null`/`undefined` keywords in function annotations) accepts it.
 */
type MaybeViewport = { readonly width: number; readonly height: number } | null;

/** Minimal `Page` shape consumed by `buildHumanizeWait`. */
interface IMockPage {
  readonly viewportSize: () => MaybeViewport;
  readonly mouse: {
    readonly move: (x: number, y: number) => Promise<void>;
  };
}

/** Production `Page` type that `buildHumanizeWait` accepts. */
type WaitPage = Parameters<typeof buildHumanizeWait>[0];

/** Optional hook simulating a page-closed mid-wait. */
type OnMoveHook = ((x: number, y: number) => Promise<void>) | false;

/** Default 1920×1080 viewport mirroring the production Camoufox pin. */
const DEFAULT_VIEWPORT: MaybeViewport = { width: 1920, height: 1080 };

/**
 * Build a mock page that records every mouse-move into the supplied
 * array. Cast through `unknown` to the production accept type so the
 * test bodies invoke `buildHumanizeWait` with a single call argument
 * (no nested `asPage(...)` call sites).
 *
 * @param moves - Array that receives `{x, y}` for each move call.
 * @param viewport - Viewport returned by `page.viewportSize()`.
 * @param onMove - Optional pre-resolution hook; can reject to
 *   simulate a closed page.
 * @returns Mock page typed as the production accept type.
 */
function makeMockPage(
  moves: IRecordedMove[],
  viewport: MaybeViewport = DEFAULT_VIEWPORT,
  onMove: OnMoveHook = false,
): WaitPage {
  const page: IMockPage = {
    /**
     * Return the configured viewport snapshot.
     * @returns Viewport or null when the test exercises the
     *   no-viewport fallback path.
     */
    viewportSize: (): MaybeViewport => viewport,
    mouse: {
      /**
       * Record the move + delegate to `onMove` (if provided).
       * @param x - Mouse X coordinate.
       * @param y - Mouse Y coordinate.
       * @returns Resolved promise, or the hook's promise.
       */
      move: (x: number, y: number): Promise<void> => {
        moves.push({ x, y });
        if (onMove === false) return Promise.resolve();
        return onMove(x, y);
      },
    },
  };
  return page as unknown as WaitPage;
}

describe('buildHumanizeWait', () => {
  it('resolves inside the requested budget for a 4 s wait', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    const budgetMs = HUMANIZE_TICK_MS * 10;
    const start = Date.now();
    const didResolve = await humanizeWait(budgetMs);
    const elapsed = Date.now() - start;
    expect(didResolve).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(budgetMs - HUMANIZE_TICK_MS);
    expect(elapsed).toBeLessThanOrEqual(budgetMs + HUMANIZE_TICK_MS * 2);
  });

  it('emits multiple jitter ticks for a 4 s budget', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    await humanizeWait(HUMANIZE_TICK_MS * 10);
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });

  it('parks the cursor at the configured corner after the last tick', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    await humanizeWait(HUMANIZE_TICK_MS * 10);
    const lastIndex = moves.length - 1;
    const last = moves[lastIndex];
    expect(last.x).toBe(HUMANIZE_END_X);
    expect(last.y).toBe(HUMANIZE_END_Y);
  });

  it('swallows mouse.move rejections (simulated page-closed)', async () => {
    const moves: IRecordedMove[] = [];
    /**
     * Always-fail mouse handler — simulates a page that closed mid-wait.
     * @returns Rejected promise.
     */
    const onMove = (): Promise<void> => Promise.reject(new Error('page closed'));
    const page = makeMockPage(moves, DEFAULT_VIEWPORT, onMove);
    const humanizeWait = buildHumanizeWait(page);
    const didResolve = await humanizeWait(HUMANIZE_TICK_MS * 3);
    expect(didResolve).toBe(true);
    expect(moves.length).toBeGreaterThanOrEqual(1);
  });

  it('never emits a negative pixel coordinate', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    await humanizeWait(HUMANIZE_TICK_MS * 10);
    const negatives = moves.filter((move): boolean => move.x < 0 || move.y < 0);
    expect(negatives).toEqual([]);
  });

  it('handles a budget shorter than one tick: zero ticks, still parks', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    const shortBudget = Math.floor(HUMANIZE_TICK_MS / 4);
    const didResolve = await humanizeWait(shortBudget);
    expect(didResolve).toBe(true);
    expect(moves.length).toBe(1);
    expect(moves[0].x).toBe(HUMANIZE_END_X);
    expect(moves[0].y).toBe(HUMANIZE_END_Y);
  });

  it('uses the viewport center as the starting cursor when viewport is available', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves);
    const humanizeWait = buildHumanizeWait(page);
    await humanizeWait(HUMANIZE_TICK_MS * 3);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    const first = moves[0];
    expect(first.x).toBeGreaterThan(0);
    expect(first.y).toBeGreaterThan(0);
  });

  it('falls back to a default starting cursor when viewport returns null', async () => {
    const moves: IRecordedMove[] = [];
    const page = makeMockPage(moves, null);
    const humanizeWait = buildHumanizeWait(page);
    const didResolve = await humanizeWait(HUMANIZE_TICK_MS * 3);
    expect(didResolve).toBe(true);
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });
});
