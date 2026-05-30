/**
 * AuthFailureWatcher Waiter — Playwright-native event-driven wait.
 */

import type { Page, Response } from 'playwright-core';

import { safeBodyPreview } from './BodyReaders.js';
import { readDetected, recordFailure } from './State.js';
import type { IAuthFailure, IWatcherState } from './Types.js';
import { isAuthEndpointUrl, isFailureStatusCode } from './UrlMatchers.js';

/**
 * Match next 4xx on a WK auth URL — Playwright waitForResponse predicate.
 * @param r - Playwright response.
 * @returns True for an auth URL with 4xx status.
 */
function isAuthFailureResponse(r: Response): boolean {
  const url = r.url();
  const isAuthUrl = isAuthEndpointUrl(url);
  if (!isAuthUrl) return false;
  const status = r.status();
  return isFailureStatusCode(status);
}

/**
 * Await the next auth failure from Playwright; returns false on timeout.
 * @param page - Playwright page.
 * @param timeoutMs - Max wait time.
 * @returns Response or false on timeout.
 */
function awaitNextResponse(page: Page, timeoutMs: number): Promise<Response | false> {
  return page
    .waitForResponse(isAuthFailureResponse, { timeout: timeoutMs })
    .catch((): false => false);
}

/**
 * Build an IAuthFailure record from a 4xx response.
 * @param next - Response that triggered the match.
 * @param preview - Masked body preview.
 * @returns Failure record.
 */
function buildFailureFromResponse(next: Response, preview: string): IAuthFailure {
  return {
    status: next.status(),
    url: next.url(),
    bodyPreview: preview,
    classifier: 'http-4xx',
  };
}

/**
 * Process a received auth response — build the failure record and
 * commit it to state. Pulled out so {@link awaitFailure} fits cap.
 * @param state - Watcher state.
 * @param next - Auth-URL response that triggered the match.
 * @returns Failure record after recording it on state.
 */
async function processAuthResponse(state: IWatcherState, next: Response): Promise<IAuthFailure> {
  const preview = await safeBodyPreview(next);
  const failure = buildFailureFromResponse(next, preview);
  recordFailure(state, failure);
  return failure;
}

/**
 * Bundled args for {@link awaitFailure} — keeps the signature 1-line
 * so the body stays within the 10-LoC cap.
 */
export interface IAwaitFailureArgs {
  page: Page;
  state: IWatcherState;
  timeoutMs: number;
}

/**
 * Awaitable wait — resolves with an existing failure synchronously,
 * otherwise uses Playwright's native event-driven `waitForResponse`.
 * @param args - Bundled page + state + timeout.
 * @returns Failure record or false on timeout.
 */
async function awaitFailure(args: IAwaitFailureArgs): Promise<IAuthFailure | false> {
  const { page, state, timeoutMs } = args;
  const detectedBefore = readDetected(state);
  if (detectedBefore) return detectedBefore;
  const next = await awaitNextResponse(page, timeoutMs);
  const detectedAfter = readDetected(state);
  if (detectedAfter) return detectedAfter;
  if (next === false) return false;
  return processAuthResponse(state, next);
}

export default awaitFailure;
