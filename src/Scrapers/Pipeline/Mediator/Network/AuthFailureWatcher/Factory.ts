/**
 * AuthFailureWatcher Factory — builds public IAuthFailureWatcher APIs.
 *
 * Provides both:
 *   * createAuthFailureWatcher — page-backed live detector
 *   * createFrozenAuthFailureWatcher — no-op stub for FrozenReplay
 */

import type { Page } from 'playwright-core';

import { buildResponseHandler } from './Inspector.js';
import type { IAuthFailure, IAuthFailureWatcher, IWatcherState } from './Types.js';
import awaitFailure from './Waiter.js';

/**
 * Reset captured state — used between retry attempts.
 * @param state - Watcher state.
 * @returns True after reset.
 */
function resetState(state: IWatcherState): boolean {
  state.detected = false;
  return true;
}

/**
 * Stop listening to page responses; idempotent.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @returns True when this call performed the unsubscribe, false when
 *   a prior dispose had already torn the watcher down.
 */
function disposeWatcher(page: Page, state: IWatcherState): boolean {
  if (state.isDisposed) return false;
  state.isDisposed = true;
  page.off('response', state.responseHandler);
  return true;
}

/**
 * Bind awaitFailure to the supplied page + state for the public API.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @param timeoutMs - Max wait time.
 * @returns Failure record or false on timeout.
 */
function waitForFailureBound(
  page: Page,
  state: IWatcherState,
  timeoutMs: number,
): Promise<IAuthFailure | false> {
  return awaitFailure(page, state, timeoutMs);
}

/**
 * Synchronously probe captured failure state.
 * @param state - Watcher state.
 * @returns Failure record if any, else false.
 */
function probeFailure(state: IWatcherState): false | IAuthFailure {
  return state.detected;
}

/**
 * Build the public watcher API bound to the supplied page + state.
 * @param page - Playwright page.
 * @param state - Mutable watcher state.
 * @returns Public watcher object.
 */
export function buildWatcherApi(page: Page, state: IWatcherState): IAuthFailureWatcher {
  return {
    waitForFailure: waitForFailureBound.bind(null, page, state),
    hasFailed: probeFailure.bind(null, state),
    reset: resetState.bind(null, state),
    dispose: disposeWatcher.bind(null, page, state),
  };
}

/**
 * Placeholder handler used while the state is constructed; replaced
 * immediately below by the real listener. Exists only so the state's
 * responseHandler field can be non-nullable.
 * @returns Always true.
 */
function placeholderHandler(): boolean {
  return true;
}

/**
 * Subscribe to page responses and return a watcher tracking the first
 * auth failure of either layer. The watcher MUST be disposed when the
 * LoginPhase exits to prevent stale OTP-flow 4xx responses from
 * polluting state.
 * @param page - Playwright page bound to the active scrape.
 * @returns Watcher API.
 */
export function createAuthFailureWatcher(page: Page): IAuthFailureWatcher {
  const state: IWatcherState = {
    detected: false,
    responseHandler: placeholderHandler,
    isDisposed: false,
  };
  const handler = buildResponseHandler(state);
  state.responseHandler = handler;
  page.on('response', handler);
  return buildWatcherApi(page, state);
}

/**
 * Stub timeout-only waiter for the frozen variant.
 * @returns Resolved promise of false.
 */
function frozenWait(): Promise<IAuthFailure | false> {
  return Promise.resolve(false);
}

/**
 * Stub probe for the frozen variant.
 * @returns Always false.
 */
function frozenProbe(): false {
  return false;
}

/**
 * Stub op for the frozen variant.
 * @returns Always true.
 */
function frozenOp(): boolean {
  return true;
}

/**
 * Build a no-op watcher for frozen-network contexts (SCRAPE phase) where
 * no live page exists. Always reports "not failed" / "timeout".
 * @returns Frozen watcher.
 */
export function createFrozenAuthFailureWatcher(): IAuthFailureWatcher {
  return {
    waitForFailure: frozenWait,
    hasFailed: frozenProbe,
    reset: frozenOp,
    dispose: frozenOp,
  };
}
