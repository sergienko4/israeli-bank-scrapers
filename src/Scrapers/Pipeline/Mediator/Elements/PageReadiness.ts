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
 * <p>The {@link waitForSpaReady} primitive raises the bar one level:
 * it waits for BOTH `load` and `networkidle` — the signal that the
 * SPA's JS bundles have executed and event handlers have bound. Stages
 * that fire clicks (HOME.ACTION, DASHBOARD.ACTION) use this stronger
 * signal because a click before handler binding falls through to default
 * browser behaviour (e.g. Visacal `<a href="#">` adds `#` to the URL
 * but the modal never opens — observed PR #221 / 2026-05-11).
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

/**
 * Awaits BOTH the `load` lifecycle event AND `networkidle` on a Page or Frame.
 *
 * <p>Stronger signal than {@link waitForDomReady}: requires the page's JS
 * bundles to have finished executing AND the network to have quiesced for
 * at least 500 ms. This is the gate before firing clicks on SPA banks whose
 * onclick handlers are bound asynchronously after parse (Visacal
 * `#ccLoginDesktopBtn` race observed 2026-05-11).
 *
 * <p>Resolves true only when both events fired within budget. Resolves
 * false on any timeout. Non-fatal — caller decides next step.
 *
 * @param target - Playwright {@link Page} or {@link Frame} to listen on.
 * @param timeoutMs - Ceiling for the combined wait in milliseconds.
 * @returns True when both `load` and `networkidle` fired within budget.
 */
async function waitForSpaReady(target: Page | Frame, timeoutMs: number): Promise<boolean> {
  return Promise.all([
    target.waitForLoadState('load', { timeout: timeoutMs }),
    target.waitForLoadState('networkidle', { timeout: timeoutMs }),
  ])
    .then((): true => true)
    .catch((): false => false);
}

export default waitForDomReady;
export { waitForDomReady, waitForSpaReady };
