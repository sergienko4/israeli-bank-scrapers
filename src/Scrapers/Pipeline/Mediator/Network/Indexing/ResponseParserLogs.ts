/**
 * Network Indexing / ResponseParserLogs — structured-log helpers for
 * the {@link ./ResponseParser.js} pipeline. Extracted per PR #276
 * review-fix so `ResponseParser.ts` fits the Section 11 150 eff-LoC
 * file cap and each log helper stays a thin, single-call function.
 */

import { getDebug } from '../../../Types/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import type { IRequestMeta } from './Indexing.js';

const LOG = getDebug(import.meta.url);

/**
 * URL segment indicating a VisaCal-style "col-rest" API call —
 * captured-miss heuristic for the response observer. Lifted into a
 * named constant per CR PR #276 post-review-fix #7 so the literal
 * does not appear inline (guideline: never hardcode values).
 */
const COL_REST_SEGMENT = '/col-rest/' as const;

/** Drop reason — emitted when a gate filters the response. */
type DropReason = 'unsupportedUrl' | 'shouldRecordResponse=false';

/** Bundled metadata for capture-miss + handler logs. */
interface IResponseMeta {
  readonly method: string;
  readonly url: string;
  readonly status: number;
}

/**
 * Permanent diagnostic — keeps the entry-log readable in pipeline.log.
 * @param meta - Request metadata.
 * @param status - HTTP status code.
 * @returns True (placeholder for chaining).
 */
function logParseEntry(meta: IRequestMeta, status: number): true {
  LOG.debug({
    event: 'parseResponse.entry',
    status,
    contentType: meta.contentType,
    method: meta.method,
    url: redactUrlFull(meta.url),
  });
  return true;
}

/**
 * Log the parseResponse drop line for either gate branch.
 * @param reason - Which gate filtered the response.
 * @param meta - Request metadata.
 * @param status - HTTP status code.
 * @returns False (caller short-circuits).
 */
function logParseDrop(reason: DropReason, meta: IRequestMeta, status: number): false {
  LOG.debug({
    event: 'parseResponse.drop',
    reason,
    status,
    contentType: meta.contentType,
    url: redactUrlFull(meta.url),
  });
  return false;
}

/**
 * Permanent diagnostic — text-read log entry.
 * @param meta - Request metadata.
 * @param status - HTTP status code.
 * @param textLen - Length of response text just read.
 * @returns True (placeholder for chaining).
 */
function logTextRead(meta: IRequestMeta, status: number, textLen: number): true {
  LOG.debug({
    event: 'parseResponse.textRead',
    status,
    textLen,
    url: redactUrlFull(meta.url),
  });
  return true;
}

/**
 * Permanent diagnostic — body-parse error log entry.
 * @param meta - Request metadata.
 * @param status - HTTP status code.
 * @param error - Caught error.
 * @returns False (caller short-circuits to the no-record branch).
 */
function logParseCatch(meta: IRequestMeta, status: number, error: Error): false {
  LOG.debug({
    event: 'parseResponse.catch',
    status,
    contentType: meta.contentType,
    url: redactUrlFull(meta.url),
    errorMessage: toErrorMessage(error),
  });
  return false;
}

/**
 * Log a captured-response miss when the URL looks interesting (POST
 * or contains {@link COL_REST_SEGMENT}) — keeps the per-handleResponse
 * function short. CR PR #276 post-review-fix #7 adds the structured
 * `event` field and lifts `/col-rest/` into a named constant.
 * @param meta - Response metadata.
 * @returns True when a miss line was logged, false when skipped.
 */
function logCaptureMiss(meta: IResponseMeta): boolean {
  const isInteresting = meta.method === 'POST' || meta.url.includes(COL_REST_SEGMENT);
  if (!isInteresting) return false;
  LOG.trace({
    event: 'captureMiss',
    method: meta.method,
    url: maskVisibleText(meta.url),
    status: meta.status,
  });
  return true;
}

/**
 * CodeRabbit PR #276 #8 — log handleResponse parseResponse errors so
 * failed captures stay observable instead of being silently lost.
 * @param url - Response URL.
 * @param error - Unknown thrown value.
 * @returns False (the promise chain stays fire-and-forget).
 */
function logHandleResponseError(url: string, error: unknown): boolean {
  LOG.debug({
    event: 'handleResponse.error',
    url: maskVisibleText(url),
    error: toErrorMessage(error as Error),
  });
  return false;
}

export {
  logCaptureMiss,
  logHandleResponseError,
  logParseCatch,
  logParseDrop,
  logParseEntry,
  logTextRead,
};
export type { DropReason, IResponseMeta };
