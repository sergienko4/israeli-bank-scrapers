/**
 * AuthFailureWatcher Inspector — per-response handler that runs both
 * detection layers against a single auth-URL response.
 */

import type { Response } from 'playwright-core';

import type { JsonValue } from '../../../Types/JsonValue.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { classifyBodyAsFailure } from './BodyClassifier.js';
import { safeBodyPreview, safeParsedBody } from './BodyReaders.js';
import { recordFailure } from './State.js';
import type { IWatcherState } from './Types.js';
import { BODY_PREVIEW_LIMIT, NO_PARSED_BODY } from './Types.js';
import { isAuthEndpointUrl, isFailureStatusCode } from './UrlMatchers.js';

/**
 * Build a masked preview string for a body-error capture.
 * @param note - Failure note from the matching pattern.
 * @param body - Parsed JSON body.
 * @returns Truncated + masked preview.
 */
function buildBodyErrorPreview(note: string, body: JsonValue): string {
  const bodyJson = JSON.stringify(body);
  const bodyJsonClipped = bodyJson.slice(0, BODY_PREVIEW_LIMIT);
  return maskVisibleText(`${note}: ${bodyJsonClipped}`);
}

/**
 * Try Layer 1 (HTTP 4xx) detection on a response. Records on hit.
 * @param state - Watcher state.
 * @param response - Auth-URL response.
 * @returns True when L1 fired (caller should stop), false otherwise.
 */
async function tryLayerOne(state: IWatcherState, response: Response): Promise<boolean> {
  const status = response.status();
  if (!isFailureStatusCode(status)) return false;
  const preview = await safeBodyPreview(response);
  const url = response.url();
  recordFailure(state, { status, url, bodyPreview: preview, classifier: 'http-4xx' });
  return true;
}

/**
 * Try Layer 2 (body-error on 200) detection on a response.
 * @param state - Watcher state.
 * @param response - Auth-URL response.
 * @returns True when L2 captured a failure, false otherwise.
 */
async function tryLayerTwo(state: IWatcherState, response: Response): Promise<boolean> {
  if (response.status() !== 200) return false;
  const body = await safeParsedBody(response);
  if (body === NO_PARSED_BODY) return false;
  const note = classifyBodyAsFailure(body);
  if (note === false) return false;
  const preview = buildBodyErrorPreview(note, body);
  const url = response.url();
  recordFailure(state, { status: 200, url, bodyPreview: preview, classifier: 'body-error' });
  return true;
}

/**
 * Run both detection layers against a single auth-URL response. Fire-
 * and-forget; updates the watcher state on the first qualifying signal.
 * @param state - Watcher state.
 * @param response - Playwright response (already auth-URL matched).
 * @returns True after inspection completes.
 */
export async function inspectAuthResponse(
  state: IWatcherState,
  response: Response,
): Promise<boolean> {
  const didFireLayerOne = await tryLayerOne(state, response);
  if (didFireLayerOne) return true;
  const didFireLayerTwo = await tryLayerTwo(state, response);
  return didFireLayerTwo;
}

/**
 * Synchronous response listener — must return boolean (no-void rule).
 * @param state - Watcher state.
 * @param response - Playwright response.
 * @returns Always true.
 */
function handleResponse(state: IWatcherState, response: Response): boolean {
  if (state.isDisposed) return false;
  if (state.detected) return false;
  const url = response.url();
  if (!isAuthEndpointUrl(url)) return false;
  const inspection = inspectAuthResponse(state, response);
  inspection.catch((): boolean => false);
  return true;
}

/**
 * Build the per-response handler closure.
 * @param state - Watcher state to update on detection.
 * @returns Playwright response listener.
 */
export function buildResponseHandler(state: IWatcherState): (response: Response) => boolean {
  return (response): boolean => handleResponse(state, response);
}
