/**
 * Fetch sub-module — diagnostic logging for native + in-page fetch calls.
 *
 * `LOG` is the shared debug namespace used by all Fetch sub-modules. The
 * tag/status/body emitters are intentionally tiny so each one stays ≤10
 * effective LoC per the canonical-10 cap.
 */

import type { Brand } from '../../../Types/Brand.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { BODY_PREVIEW_LIMIT, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from '../FetchConfig.js';
import { detectWafBlock } from './WafDetection.js';

/** Branded marker — every log emitter returns this so Rule #15 (no primitive returns) passes. */
export type LogEmitted = Brand<true, 'LogEmitted'>;

/** Singleton emitted-marker. */
const EMITTED: LogEmitted = true as LogEmitted;

export const LOG = getDebug(import.meta.url);

/**
 * Log an API call with its tag, status, and duration.
 * @param tag - A short description of the API call.
 * @param status - The HTTP response status code.
 * @param durationMs - Time elapsed in milliseconds.
 * @returns Branded `LogEmitted` marker after logging completes.
 */
export function logApiCall(tag: string, status: number, durationMs: number): LogEmitted {
  LOG.debug({
    message: `${tag} → ${String(status)} (${String(durationMs)}ms)`,
  });
  return EMITTED;
}

/**
 * Emit the body-preview line when the body is non-empty.
 * @param text - The response body text.
 * @returns Branded marker.
 */
function logBodyPreview(text: string): LogEmitted {
  if (text === '') return EMITTED;
  const bodyPreview = text.substring(0, BODY_PREVIEW_LIMIT);
  LOG.debug({ message: `response body: ${maskVisibleText(bodyPreview)}` });
  return EMITTED;
}

/**
 * Emit the non-200 status line when status is outside the success set.
 * @param status - HTTP status code.
 * @param url - Request URL (for masked diagnostic).
 * @returns Branded marker.
 */
function logNon200(status: number, url: string): LogEmitted {
  if (status === HTTP_STATUS_OK || status === HTTP_STATUS_NO_CONTENT) return EMITTED;
  LOG.debug({ message: `non-200: status=${String(status)} url=${maskVisibleText(url)}` });
  return EMITTED;
}

/**
 * Emit the WAF block line when the heuristic fires.
 * @param status - HTTP status code.
 * @param text - The response body text.
 * @param url - Request URL.
 * @returns Branded marker.
 */
function logWafBlock(status: number, text: string, url: string): LogEmitted {
  const wafReason = detectWafBlock(status, text);
  if (!wafReason) return EMITTED;
  LOG.debug({ message: `WAF block: ${wafReason} url=${maskVisibleText(url)}` });
  return EMITTED;
}

/**
 * Log response issues such as non-200 status or WAF blocks.
 * @param status - The HTTP response status code.
 * @param text - The response body text (empty string for 204 responses).
 * @param url - The request URL for debug output.
 * @returns Branded `LogEmitted` marker after logging completes.
 */
export function logResponseIssues(status: number, text: string, url: string): LogEmitted {
  logBodyPreview(text);
  logNon200(status, url);
  logWafBlock(status, text, url);
  return EMITTED;
}
