/**
 * AuthFailureWatcher Factory — builds public IAuthFailureWatcher APIs.
 *
 * Provides both:
 *   * createAuthFailureWatcher — page-backed live detector
 *   * createFrozenAuthFailureWatcher — no-op stub for FrozenReplay
 */

import type { Page } from 'playwright-core';

import { getDebug, type ScraperLogger } from '../../../Types/Debug.js';
import { buildAuthRequestFailedHandler, buildAuthRequestHandler } from './AuthReqTrace.js';
import { readAuthReqTraceGate } from './AuthReqTraceGate.js';
import { buildResponseHandler } from './Inspector.js';
import type { IAuthFailure, IAuthFailureWatcher, IWatcherState } from './Types.js';
import awaitFailure from './Waiter.js';

const LOG = getDebug(import.meta.url);

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
  unbindRequestTrace(page, state);
  return true;
}

/**
 * Remove gated request-level trace listeners when they were attached.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @returns True when at least one listener was removed.
 */
function unbindRequestTrace(page: Page, state: IWatcherState): boolean {
  const didRemoveRequest = unbindRequest(page, state);
  const didRemoveFailure = unbindRequestFailed(page, state);
  return didRemoveRequest || didRemoveFailure;
}

/**
 * Remove the gated request listener when present.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @returns True when removed.
 */
function unbindRequest(page: Page, state: IWatcherState): boolean {
  if (!state.requestHandler) return false;
  page.off('request', state.requestHandler);
  return true;
}

/**
 * Remove the gated requestfailed listener when present.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @returns True when removed.
 */
function unbindRequestFailed(page: Page, state: IWatcherState): boolean {
  if (!state.requestFailedHandler) return false;
  page.off('requestfailed', state.requestFailedHandler);
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
  return awaitFailure({ page, state, timeoutMs });
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
 * Build the initial watcher state struct.
 * @returns Fresh IWatcherState with no handler bound.
 */
function newWatcherState(): IWatcherState {
  return {
    detected: false,
    responseHandler: placeholderHandler,
    requestHandler: false,
    requestFailedHandler: false,
    isDisposed: false,
  };
}

/**
 * Attach request/requestfailed auth tracing only when the env gate is ON.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @param logger - Pipeline logger.
 * @returns True only when listeners were attached.
 */
function bindRequestTrace(page: Page, state: IWatcherState, logger: ScraperLogger): boolean {
  if (!readAuthReqTraceGate().enabled) return false;
  const startedAtMs = Date.now();
  state.requestHandler = buildAuthRequestHandler(logger, startedAtMs);
  state.requestFailedHandler = buildAuthRequestFailedHandler(logger, startedAtMs);
  page.on('request', state.requestHandler);
  page.on('requestfailed', state.requestFailedHandler);
  return true;
}

/**
 * Attach the response-keyed auth failure listener.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @returns True after binding.
 */
function bindResponseTrace(page: Page, state: IWatcherState): true {
  const handler = buildResponseHandler(state);
  state.responseHandler = handler;
  page.on('response', handler);
  return true;
}

/**
 * Subscribe to page responses and return a watcher tracking the first
 * auth failure of either layer. The watcher MUST be disposed when the
 * LoginPhase exits to prevent stale OTP-flow 4xx responses from
 * polluting state.
 * @param page - Playwright page bound to the active scrape.
 * @param logger - Pipeline logger for gated request-level traces.
 * @returns Watcher API.
 */
export function createAuthFailureWatcher(
  page: Page,
  logger: ScraperLogger = LOG,
): IAuthFailureWatcher {
  const state = newWatcherState();
  bindResponseTrace(page, state);
  bindRequestTrace(page, state, logger);
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
