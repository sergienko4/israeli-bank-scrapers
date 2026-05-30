/**
 * Fetch sub-module — JSON parse + error handling helpers.
 *
 * Shared by both `fetchGetWithinPage` and `fetchPostWithinPage`. Centralises
 * the "empty body → {} / parse error → ScraperError or EMPTY_RESULT"
 * contract so the caller modules stay shape-symmetrical.
 */

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../../../Base/ScraperError.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { JsonValue } from '../../../Types/JsonValue.js';

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
export const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/** Options for handling a JSON parse error. */
export interface IParseErrorOpts {
  readonly err: Error;
  readonly shouldIgnore: boolean;
  readonly url: string;
  readonly status: number;
  readonly context: string;
}

/**
 * Build the human-readable ScraperError message for a JSON parse failure.
 * @param opts - Parse error details.
 * @returns Formatted error message.
 */
function buildParseErrorMessage(opts: IParseErrorOpts): string {
  const msg = toErrorMessage(opts.err);
  const statusStr = String(opts.status);
  return `${opts.context} parse error: ${msg}, url: ${opts.url}, status: ${statusStr}`;
}

/**
 * Handle a JSON parse error — throw ScraperError or return EMPTY_RESULT.
 * Returns {@link Nullable}<{@link JsonValue}> so callers can safely receive
 * objects, arrays, or top-level primitives without an unsafe cast.
 * @param opts - Error details and handling options.
 * @returns EMPTY_RESULT when errors are ignored.
 */
export function handleParseError(opts: IParseErrorOpts): Nullable<JsonValue> {
  if (opts.shouldIgnore) return EMPTY_RESULT;
  throw new ScraperError(buildParseErrorMessage(opts));
}

/**
 * Try to JSON.parse a body string; route parse errors through {@link handleParseError}.
 * Extracted so the two public parsers fit the 10-LoC cap.
 * @param body - Raw body text (caller already checked for empty).
 * @param opts - Parse-error routing options (ignore-flag + url + status + context).
 * @returns Parsed JSON or EMPTY_RESULT when errors are ignored.
 */
function tryParseOrHandle(body: string, opts: Omit<IParseErrorOpts, 'err'>): Nullable<JsonValue> {
  try {
    return JSON.parse(body) as JsonValue;
  } catch (error) {
    return handleParseError({ ...opts, err: error as Error });
  }
}

/** Options for parsing a GET-within-page response. */
export interface IParseGetOpts {
  result: string;
  status: number;
  url: string;
  shouldIgnoreErrors: boolean;
}

/**
 * Parse the text result of a GET-within-page call into JSON.
 * @param opts - The response text, status, URL, and error handling flag.
 * @returns The parsed JSON value (object, array, or primitive), null if parse fails and errors are ignored, or empty object for empty responses.
 */
export function parseGetResult(opts: IParseGetOpts): Nullable<JsonValue> {
  const { result, status, url, shouldIgnoreErrors } = opts;
  if (result === '') return {};
  return tryParseOrHandle(result, {
    shouldIgnore: shouldIgnoreErrors,
    url,
    status,
    context: 'fetchGetWithinPage',
  });
}

/** Options for parsing a POST-within-page response. */
export interface IParsePostOpts {
  text: string;
  status: number;
  url: string;
  opts: { shouldIgnoreErrors?: boolean };
}

/**
 * Build the parse-error routing options for the POST-within-page parser.
 * Pulled out so {@link parsePostResult} fits the 10-LoC cap.
 * @param url - Target URL (for error reporting).
 * @param status - HTTP status from the in-page evaluator.
 * @param shouldIgnore - Whether to swallow parse errors.
 * @returns Routing options without the `err` field.
 */
function postParseOpts(
  url: string,
  status: number,
  shouldIgnore: boolean,
): Omit<IParseErrorOpts, 'err'> {
  return { shouldIgnore, url, status, context: 'fetchPostWithinPage' };
}

/**
 * Parse the text result of a POST-within-page call into JSON.
 * @param pOpts - The response text, status, URL, and fetch options.
 * @returns The parsed JSON value (object, array, or primitive), null if parse fails and errors are ignored, or empty object for empty responses.
 */
export function parsePostResult(pOpts: IParsePostOpts): Nullable<JsonValue> {
  const { text, status, url, opts } = pOpts;
  const { shouldIgnoreErrors = false } = opts;
  if (text === '') return {};
  const parseOpts = postParseOpts(url, status, shouldIgnoreErrors);
  return tryParseOrHandle(text, parseOpts);
}
