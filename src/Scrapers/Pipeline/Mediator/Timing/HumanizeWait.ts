/**
 * Humanized settle — mouse-jitter implementation used by the central
 * `phaseSettle` in `Core/Executor/PipelineReducer.ts` for the
 * pre-auth phase whitelist (INIT, HOME, LOGIN). Extracted into its
 * own module so `CreateElementMediator.ts` only pulls in the single
 * builder factory rather than four `TimingConfig` constants — keeping
 * the mediator file inside the `import-x/max-dependencies` cap.
 *
 * <p>Mission: bank-side bot detection (Hapoalim hCaptcha, Isracard
 * temp-fault page) profiles the pre-auth window for "human input
 * present?". A silent 4 s settle reads as bot and the bank responds
 * with a challenge / error page. This helper emits roughly one
 * mouse-move every {@link HUMANIZE_TICK_MS} across the budget, each
 * within {@link HUMANIZE_JITTER_RADIUS_PX} of the previous position,
 * then parks the cursor at the top-left so downstream
 * `resolveVisible` runs against a deterministic position.
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import type { Page } from 'playwright-core';

import type { IElementMediator } from '../Elements/ElementMediator.js';
import {
  HUMANIZE_END_X,
  HUMANIZE_END_Y,
  HUMANIZE_JITTER_RADIUS_PX,
  HUMANIZE_TICK_MS,
} from './TimingConfig.js';

/** Mutable cursor position threaded through the reduce chain. */
interface IJitterCursor {
  x: number;
  y: number;
}

/**
 * Compute the next jitter pixel position bounded inside the
 * `HUMANIZE_JITTER_RADIUS_PX` band around the previous position.
 * Coordinates clamped to non-negative integers so Playwright never
 * sees a negative pixel.
 *
 * @param prevX - Previous cursor X.
 * @param prevY - Previous cursor Y.
 * @returns Next position tuple.
 */
function nextJitterPosition(prevX: number, prevY: number): readonly [number, number] {
  const dx = Math.round((Math.random() - 0.5) * 2 * HUMANIZE_JITTER_RADIUS_PX);
  const dy = Math.round((Math.random() - 0.5) * 2 * HUMANIZE_JITTER_RADIUS_PX);
  const nextX = Math.max(0, prevX + dx);
  const nextY = Math.max(0, prevY + dy);
  return [nextX, nextY] as const;
}

/**
 * Resolve the cursor start position. Centre of the Camoufox viewport
 * so the random walk has equal room in every direction before it
 * parks at the corner.
 *
 * @param page - The Playwright page bound to this mediator instance.
 * @returns Starting cursor coordinates.
 */
function startCursor(page: Page): IJitterCursor {
  const vp = page.viewportSize();
  const w = vp?.width ?? HUMANIZE_JITTER_RADIUS_PX * 24;
  const h = vp?.height ?? HUMANIZE_JITTER_RADIUS_PX * 14;
  return { x: Math.floor(w / 2), y: Math.floor(h / 2) };
}

/**
 * Run a single jitter tick — move the cursor once + wait one tick.
 * Best-effort: any `mouse.move` rejection is swallowed so a closing
 * page does not break the settle.
 *
 * @param page - The Playwright page.
 * @param cursor - Mutable cursor (updated in place).
 * @returns True after the tick completes.
 */
async function runJitterTick(page: Page, cursor: IJitterCursor): Promise<true> {
  const [nextX, nextY] = nextJitterPosition(cursor.x, cursor.y);
  cursor.x = nextX;
  cursor.y = nextY;
  await page.mouse.move(cursor.x, cursor.y).catch((): true => true);
  await setTimeoutPromise(HUMANIZE_TICK_MS, undefined, { ref: false });
  return true as const;
}

/**
 * Park the cursor at the top-left after the last jitter tick, after
 * exhausting any remaining time in the budget.
 *
 * @param page - The Playwright page.
 * @param remainingMs - Leftover budget time after the tick chain.
 * @returns True after parking.
 */
async function parkCursor(page: Page, remainingMs: number): Promise<true> {
  if (remainingMs > 0) {
    await setTimeoutPromise(remainingMs, undefined, { ref: false });
  }
  await page.mouse.move(HUMANIZE_END_X, HUMANIZE_END_Y).catch((): true => true);
  return true as const;
}

/**
 * Build the `humanizeWait` mediator method bound to a Playwright Page.
 *
 * @param page - The Playwright page.
 * @returns Mediator humanizeWait function.
 */
export default function buildHumanizeWait(page: Page): IElementMediator['humanizeWait'] {
  return async (budgetMs: number): Promise<true> => {
    const start = Date.now();
    const cursor = startCursor(page);
    // `-1` reserves one tick's worth of budget so `parkCursor` always
    // has time to land at the corner before the wall-clock window
    // ends — keeps the total wait inside `budgetMs` even after
    // mouse-move CDP overhead per tick (~5-20 ms).
    const tickCount = Math.max(0, Math.floor(budgetMs / HUMANIZE_TICK_MS) - 1);
    const ticks = Array.from({ length: tickCount }, (_, i): number => i);
    const initialPromise: Promise<true> = Promise.resolve(true as const);
    const tickChain = ticks.reduce<Promise<true>>(async (prev): Promise<true> => {
      await prev;
      return runJitterTick(page, cursor);
    }, initialPromise);
    await tickChain;
    const remaining = Math.max(0, budgetMs - (Date.now() - start));
    return parkCursor(page, remaining);
  };
}
