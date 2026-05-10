/**
 * Page-readiness primitives — event-driven waits shared across phases.
 *
 * <p>Extracted from INIT.FINAL after live runs proved LOGIN.PRE faces
 * the same SPA-render race: when downstream DOM probes fire before the
 * HTML parser finishes, `resolveField` sees an empty document and
 * reports "no password field". Both phases need the same
 * `domcontentloaded` gate. Centralising the call shape removes the
 * duplication and yields a single audit point for the wait contract.
 *
 * <p>ZERO HTML scanning — Playwright fires the listener from a browser
 * lifecycle event, not a DOM query.
 */

import type { Frame, Page } from 'playwright-core';

/**
 * Awaits the `domcontentloaded` lifecycle event on a Page or Frame.
 *
 * <p>Resolves true when the HTML parser has finished (DOM usable).
 * Resolves false on timeout. The caller decides whether a timeout is
 * fatal (INIT.FINAL fails loud; LOGIN.PRE continues — the resolver's
 * per-frame retry absorbs slow SPAs).
 *
 * @param target - Playwright {@link Page} or {@link Frame} to listen on.
 * @param timeoutMs - Ceiling for the wait in milliseconds.
 * @returns True when the event fired within the budget, false on timeout.
 */
async function waitForDomReady(target: Page | Frame, timeoutMs: number): Promise<boolean> {
  return target
    .waitForLoadState('domcontentloaded', { timeout: timeoutMs })
    .then((): true => true)
    .catch((): false => false);
}

export default waitForDomReady;
