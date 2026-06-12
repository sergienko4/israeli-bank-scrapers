/**
 * Locator race + hit-test primitives. Public surface is a triple:
 *   - `raceLocators`  — first locator to reach `state` wins (used by
 *     attached-click fallback where the compositor hit-test is moot).
 *   - `raceLocatorsWithHitTest` — race + elementFromPoint validation +
 *     skip-link filter (the primary path used by every resolve-visible
 *     helper in the mediator).
 *   - `IRaceDiagnostic` — structured trace payload describing winner,
 *     fulfilled count, hit-test pass count, and fulfilled indices.
 *
 * Every helper between `raceLocators` and `raceLocatorsWithHitTest`
 * (visible-await → skip-link filter → hit-test → resolveWinner) is kept
 * private because its only call-site is the parent race orchestration —
 * Pipeline Rule #15 (no primitive returns at exported boundaries) plus
 * cohesion both push that direction.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §4) so the god
 * module no longer owns elementFromPoint hit-test orchestration.
 */

import type { Locator } from 'playwright-core';

/** Playwright element wait state for locator races. */
type WaitState = 'visible' | 'attached';

/**
 * Race all locators in parallel — first matching state wins in wall-clock
 * time. Returns the index of the first locator to settle on `state`, or
 * `-1` when none reach the state inside `timeout`.
 *
 * Implementation uses `Promise.any` over a per-locator
 * `loc.waitFor({state,timeout}).then(() => i)` so the result reflects
 * actual settle order — NOT input-array order. (The previous
 * `Promise.allSettled` + `find` pattern silently picked the lowest
 * input-array index that eventually fulfilled, defeating the race
 * contract documented in the attached-click fallback caller.)
 *
 * Rejection path: `Promise.any` rejects with `AggregateError` only when
 * EVERY waiter rejects (typical timeout). We catch that and return `-1`
 * so the caller can fall through to its NOT_FOUND branch.
 * @param locators - Array of Playwright locators to race.
 * @param timeout - Timeout in ms for each locator.
 * @param state - Element state to wait for (default: 'visible').
 * @returns Index of first matching locator (wall-clock), or -1 if none.
 */
export async function raceLocators(
  locators: Locator[],
  timeout: number,
  state: WaitState = 'visible',
): Promise<number> {
  if (locators.length === 0) return -1;
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state, timeout });
    return i;
  });
  return Promise.any(waiters).catch((): number => -1);
}

/**
 * Browser-evaluated predicate: returns true iff the element's className
 * contains any well-known accessibility skip-link / sr-only marker
 * (`skip-to-main`, `skip-link`, `sr-only`, `visually-hidden`).
 *
 * <p>Top-level pure function (no captured closures) so Playwright's
 * evaluate serialization can transport it into the page context. The
 * regex literal is duplicated inline between this predicate and
 * {@link isElementHitTestable} because Playwright's `evaluate(fn, arg)`
 * cannot transport a regex argument without an `unknown` cast the
 * project ban-list rejects, and a captured top-level const is not
 * serialized into the page context together with the function body.
 *
 * @param el - Target element under test.
 * @returns true iff the element is an a11y skip-link / sr-only wrapper.
 */
function isAccessibilitySkipLink(el: Element): boolean {
  const cls = el.className;
  return /skip-to-main|skip-link|sr-only|visually-hidden/i.test(cls);
}

/**
 * Browser-evaluated hit-test predicate. MUST be a top-level pure function
 * (no captured closures) so Playwright's evaluate serialization can
 * transport it into the page context.
 *
 * Rejects disabled placeholders BEFORE hit-test (Wix renders a disabled
 * `<button role="link">` over the real link on some bank templates).
 * Also rejects accessibility skip-link / sr-only / visually-hidden
 * wrappers inline (defense in depth for the #309 Discount skip-link
 * collision — covered upstream by {@link filterOutSkipLinks} but
 * duplicated here so a regression of either guard alone still rejects
 * the wrong element).
 *
 * NOTE: the skip-link regex literal is INTENTIONALLY duplicated from
 * {@link isAccessibilitySkipLink} (line ~66). Both functions are
 * Playwright `evaluate(...)` payloads — their bodies travel to the
 * page context as serialised source, so a captured `const
 * SKIP_LINK_PATTERN = ...` at module scope is NOT available. Passing
 * the pattern as an `evaluate(fn, arg)` arg requires an `unknown` cast
 * that the project ban-list rejects. If you tighten the pattern in one
 * site, update BOTH inline literals.
 * @param el - Target element under test.
 * @returns True when the element is hit-testable at its center point.
 */
function isElementHitTestable(el: Element): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  const cls = el.className;
  if (/skip-to-main|skip-link|sr-only|visually-hidden/i.test(cls)) return false;
  const rect = el.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return el === hit || el.contains(hit);
}

/**
 * Hit-test — check elementFromPoint at element center.
 * @param locator - The Playwright locator to test.
 * @returns True when the element is hit-testable.
 */
async function isTrulyVisible(locator: Locator): Promise<boolean> {
  return locator.evaluate(isElementHitTestable).catch((): boolean => false);
}

/** Race diagnostic — trace-level detail about what happened. */
export interface IRaceDiagnostic {
  readonly winner: number;
  readonly fulfilledCount: number;
  readonly hitTestPassedCount: number;
  readonly fulfilledIndices: readonly number[];
}

/**
 * Await waitFor(visible) on all locators; return indices that resolved.
 * @param locators - Locators to race.
 * @param timeout - Per-locator waitFor timeout.
 * @returns Indices that passed Playwright visibility check.
 */
async function awaitVisibleIndices(
  locators: Locator[],
  timeout: number,
): Promise<readonly number[]> {
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results
    .filter((r): boolean => r.status === 'fulfilled')
    .map((r): number => (r as PromiseFulfilledResult<number>).value);
}

/**
 * Run hit-test on every fulfilled index; return those that passed.
 * @param locators - All locators (indexed by fulfilled).
 * @param fulfilled - Indices that already passed visibility check.
 * @returns Indices that ALSO passed elementFromPoint hit-test.
 */
async function hitTestIndices(
  locators: Locator[],
  fulfilled: readonly number[],
): Promise<readonly number[]> {
  const promises = fulfilled.map(async (idx): Promise<number> => {
    const isHit = await isTrulyVisible(locators[idx]);
    return isHit ? idx : -1;
  });
  const tests = await Promise.all(promises);
  return tests.filter((idx): boolean => idx >= 0);
}

/**
 * Per-locator skip-link probe. Returns the index when the locator's
 * element is NOT a skip-link; returns -1 otherwise. Errors are treated
 * as "not a skip-link" (best-effort filter, do not block on probe
 * failure).
 * @param locators - All locators (indexed by `idx`).
 * @param idx - Index to probe.
 * @returns `idx` when not a skip-link; `-1` otherwise.
 */
async function probeNotSkipLinkIndex(locators: Locator[], idx: number): Promise<number> {
  const isSkip = await locators[idx].evaluate(isAccessibilitySkipLink).catch((): boolean => false);
  return isSkip ? -1 : idx;
}

/**
 * Filter fulfilled indices to those whose elements are NOT a11y
 * skip-link / sr-only wrappers. Upstream pre-filter for
 * {@link raceLocatorsWithHitTest} that defends BOTH the
 * `hitPassed[0]` primary path AND the `fulfilled[0]` fallback path in
 * {@link resolveWinner} (#309).
 * @param locators - All locators (indexed by fulfilled).
 * @param fulfilled - Indices that passed visibility check.
 * @returns Indices whose elements are NOT accessibility skip-links.
 */
async function filterOutSkipLinks(
  locators: Locator[],
  fulfilled: readonly number[],
): Promise<readonly number[]> {
  const probes = fulfilled.map((idx): Promise<number> => probeNotSkipLinkIndex(locators, idx));
  const results = await Promise.all(probes);
  return results.filter((idx): boolean => idx >= 0);
}

/**
 * Race locators then validate winner with elementFromPoint hit-test.
 * If winner fails hit-test, check remaining settled results.
 * Falls back to first Playwright-visible if no hit-test passes.
 * @param locators - Locators to race.
 * @param timeout - Timeout in ms.
 * @returns Diagnostic with winner + fulfilled detail.
 */
export async function raceLocatorsWithHitTest(
  locators: Locator[],
  timeout: number,
): Promise<IRaceDiagnostic> {
  const fulfilledRaw = await awaitVisibleIndices(locators, timeout);
  const fulfilled = await filterOutSkipLinks(locators, fulfilledRaw);
  const hitPassed = await hitTestIndices(locators, fulfilled);
  return {
    winner: resolveWinner(hitPassed, fulfilled),
    fulfilledCount: fulfilled.length,
    hitTestPassedCount: hitPassed.length,
    fulfilledIndices: fulfilled,
  };
}

/**
 * Pick winner: hit-test winner first, then first visible fallback.
 * Fallback handles overlays (cookie banners) on bank homepages.
 * @param hitPassed - Indices that passed hit-test.
 * @param fulfilled - Indices that passed waitFor visible.
 * @returns Winner index or -1.
 */
function resolveWinner(hitPassed: readonly number[], fulfilled: readonly number[]): number {
  if (hitPassed.length > 0) return hitPassed[0];
  if (fulfilled.length > 0) return fulfilled[0];
  return -1;
}
