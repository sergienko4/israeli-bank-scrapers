/**
 * Auth Failure Watcher — fires the moment a WK auth endpoint signals an
 * invalid-credentials response.
 *
 * Generic across all banks. Two detection layers:
 *
 *   Layer 1 — HTTP 4xx on a URL matching PIPELINE_WELL_KNOWN_API.auth.
 *             Universal contract.
 *
 *   Layer 2 — HTTP 200 on an auth URL whose JSON body matches one of
 *             AUTH_BODY_FAILURE_PATTERNS. Patterns derived from real
 *             network captures of every migrated pipeline bank — kept
 *             in ONE shared table so adding a new bank is a single-row
 *             addition, never a per-bank scraper change.
 *
 * Phase-bounded: the LoginPhase creates one watcher and disposes it
 * before OTP / dashboard phases begin, so OTP-flow 4xx events on the
 * same auth-URL family cannot pollute state.
 */

import type { Page, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../Types/Debug.js';
import type { JsonValue, MaybeJsonValue } from '../../Types/Json.js';
import { maskVisibleText } from '../../Types/LogEvent.js';

const LOG = getDebug(import.meta.url);

/** Body preview is masked + truncated to this length before logging. */
const BODY_PREVIEW_LIMIT = 256;
/** HTTP status range counted as a credential rejection. */
const FAIL_STATUS_MIN = 400;
const FAIL_STATUS_MAX = 499;

/** Classifier label distinguishing which detector layer fired. */
type AuthFailureClassifier = 'http-4xx' | 'body-error';

/**
 * Pattern row matching a body field whose value indicates an auth failure.
 * The pattern table is the single place that knows how each bank signals
 * failure in a 200 response.
 */
interface IBodyFailurePattern {
  /** JSON field name to inspect on the parsed response body. */
  readonly field: string;
  /** Predicate — true means this value denotes an auth failure. */
  readonly isFailure: (value: JsonValue) => boolean;
  /** Documents which bank's contract motivated the row. */
  readonly note: string;
}

/**
 * Predicate: true when a numeric login-status field signals failure.
 * @param v - JSON value at the field.
 * @returns True when v is a non-zero number.
 */
function isNonZeroNumber(v: JsonValue): boolean {
  return typeof v === 'number' && v !== 0;
}

/**
 * Predicate: true when error_code is a non-zero number or non-zero string.
 * Beinleumi-shape: success returns 0 (number) or "0" (string).
 * @param v - JSON value at the field.
 * @returns True when v indicates failure.
 */
function isErrorCodeFailure(v: JsonValue): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v !== '0';
  return false;
}

/**
 * Predicate: true when an `error` field carries any non-empty value.
 * Hapoalim-shape: success returns null; failure returns object/string.
 * @param v - JSON value at the field.
 * @returns True when v indicates a populated error.
 */
function isErrorObjectFailure(v: JsonValue): boolean {
  if (v === null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/**
 * Predicate: true when a Status string is anything other than "SUCCESS".
 * Discount-shape: { Login: { Status: "SUCCESS" } } on success.
 * @param v - JSON value at the field.
 * @returns True when v is a non-success status string.
 */
function isNonSuccessStatus(v: JsonValue): boolean {
  return typeof v === 'string' && v !== 'SUCCESS' && v.length > 0;
}

/**
 * Body-error patterns derived from real network captures of every migrated
 * pipeline bank. New bank = optionally add ONE row. No per-bank code.
 */
const AUTH_BODY_FAILURE_PATTERNS: readonly IBodyFailurePattern[] = [
  {
    field: 'LoginStatus',
    isFailure: isNonZeroNumber,
    note: 'Max — Result.LoginStatus !== 0 means invalid credentials',
  },
  {
    field: 'ReturnCode',
    isFailure: isNonZeroNumber,
    note: 'Max — top-level ReturnCode !== 0 means transport error or rejection',
  },
  {
    field: 'error_code',
    isFailure: isErrorCodeFailure,
    note: 'Beinleumi — { error_code, error_message, data } at top level',
  },
  {
    field: 'error',
    isFailure: isErrorObjectFailure,
    note: 'Hapoalim — top-level error object/string',
  },
  {
    field: 'Status',
    isFailure: isNonSuccessStatus,
    note: 'Discount — Login.Status !== "SUCCESS"',
  },
];

/** Auth-failure record produced by either detection layer. */
interface IAuthFailure {
  /** HTTP status code observed (200 for body-error layer, 4xx for status layer). */
  readonly status: number;
  /** Auth endpoint URL that failed. */
  readonly url: string;
  /** Truncated, masked body preview for diagnostics. */
  readonly bodyPreview: string;
  /** Which detection layer fired. */
  readonly classifier: AuthFailureClassifier;
}

/** Public watcher contract consumed by the LoginPhase. */
interface IAuthFailureWatcher {
  /**
   * Resolve with the next observed auth failure, or false on timeout.
   * Returns the existing failure synchronously if one was already seen.
   */
  readonly waitForFailure: (timeoutMs: number) => Promise<IAuthFailure | false>;
  /** Synchronous probe — a captured failure if any, false otherwise. */
  readonly hasFailed: () => false | IAuthFailure;
  /** Clear any captured failure (used between retry attempts). */
  readonly reset: () => boolean;
  /** Stop listening — called when the LoginPhase exits. */
  readonly dispose: () => boolean;
}

/**
 * Test if a URL matches the WellKnown auth-endpoint regex set.
 * @param url - Response URL.
 * @returns True when at least one auth pattern matches.
 */
function isAuthEndpointUrl(url: string): boolean {
  return PIPELINE_WELL_KNOWN_API.auth.some((p): boolean => p.test(url));
}

/**
 * Test if an HTTP status code falls in the 4xx auth-rejection range.
 * @param status - Response status code.
 * @returns True when status is 400..499 inclusive.
 */
function isFailureStatusCode(status: number): boolean {
  return status >= FAIL_STATUS_MIN && status <= FAIL_STATUS_MAX;
}

/**
 * Test whether a single record (top-level or nested) matches any pattern.
 * @param record - Object to inspect.
 * @returns Note from the matching pattern, or false.
 */
function matchInRecord(record: Record<string, JsonValue>): string | false {
  /**
   * Per-pattern match against this record.
   * @param pattern - Body-failure pattern row.
   * @returns True when the row's field is present and predicate fires.
   */
  const fits = (pattern: IBodyFailurePattern): boolean => {
    if (!(pattern.field in record)) return false;
    return pattern.isFailure(record[pattern.field]);
  };
  const hit = AUTH_BODY_FAILURE_PATTERNS.find(fits);
  if (!hit) return false;
  return hit.note;
}

/**
 * Inspect a parsed JSON body against the shared failure-pattern table.
 * Checks the top-level object first, then walks one level deep into any
 * nested object values. The one-level walk catches bank shapes that
 * nest the failure marker under a wrapper (Max → `Result.LoginStatus`,
 * Discount → `Login.Status`). Generic — no per-bank knowledge of
 * which wrapper key a given bank uses.
 * @param body - Parsed JSON response body.
 * @returns Matching pattern note when failure detected, false otherwise.
 */
function classifyBodyAsFailure(body: MaybeJsonValue): string | false {
  if (body === null || typeof body !== 'object') return false;
  const topRecord = body as Record<string, JsonValue>;
  const topHit = matchInRecord(topRecord);
  if (topHit !== false) return topHit;
  // One-level walk: scan each nested object value.
  const nestedValues = Object.values(topRecord);
  /**
   * Try to match one nested value against the pattern table.
   * @param value - Nested JSON value.
   * @returns Note when matched, false otherwise.
   */
  const matchNested = (value: JsonValue): string | false => {
    if (value === null || typeof value !== 'object') return false;
    return matchInRecord(value as Record<string, JsonValue>);
  };
  /**
   * Predicate: nested value matched a failure pattern.
   * @param value - Nested JSON value.
   * @returns True when matchNested returned a note.
   */
  const didMatch = (value: JsonValue): boolean => matchNested(value) !== false;
  const matchedValue = nestedValues.find(didMatch);
  if (matchedValue === undefined) return false;
  return matchNested(matchedValue);
}

/**
 * Read response body text safely; returns empty string on any error.
 * @param response - Playwright response object.
 * @returns Raw body text up to the preview limit, masked + truncated.
 */
async function safeBodyPreview(response: Response): Promise<string> {
  const raw = await response.text().catch((): string => '');
  const slice = raw.slice(0, BODY_PREVIEW_LIMIT);
  return maskVisibleText(slice);
}

/** Sentinel returned by safeParsedBody when no JSON could be parsed. */
const NO_PARSED_BODY = '__NO_PARSED_BODY__';

/**
 * Try to parse a response body as JSON for L2 inspection. Returns the
 * NO_PARSED_BODY sentinel string when no body could be parsed (the
 * `unknown` JSON value type already includes `false`, so a separate
 * union with `false` is redundant per typescript-eslint).
 * @param response - Playwright response object.
 * @returns Parsed value, or NO_PARSED_BODY sentinel on any error.
 */
async function safeParsedBody(response: Response): Promise<JsonValue> {
  const text = await response.text().catch((): string => '');
  if (text.length === 0) return NO_PARSED_BODY;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return NO_PARSED_BODY;
  }
}

/** Internal mutable state of an active watcher instance. */
interface IWatcherState {
  detected: false | IAuthFailure;
  /** Always set immediately by createAuthFailureWatcher; non-nullable so
   *  disposeFn can call page.off without a runtime guard. */
  responseHandler: (response: Response) => boolean;
  isDisposed: boolean;
}

/**
 * Record a captured failure on state. Logs first capture only.
 * Idempotent — re-recording on the same state is a no-op.
 * @param state - Watcher state.
 * @param failure - Captured failure record.
 * @returns True when this call recorded a new failure, false when a
 * prior call had already captured one (idempotent skip).
 */
function recordFailure(state: IWatcherState, failure: IAuthFailure): boolean {
  if (state.detected) return false;
  state.detected = failure;
  LOG.debug({
    classifier: failure.classifier,
    status: failure.status,
    url: maskVisibleText(failure.url),
  });
  return true;
}

/**
 * Run both detection layers against a single auth-URL response. Fire-
 * and-forget; updates the watcher state on the first qualifying signal.
 * @param state - Watcher state.
 * @param response - Playwright response (already auth-URL matched).
 * @returns True after inspection completes (always — fire-and-forget).
 */
async function inspectAuthResponse(state: IWatcherState, response: Response): Promise<boolean> {
  // No state.detected guard here — recordFailure() is self-idempotent
  // (returns true and skips when already detected). Avoids dead-code
  // branch that fan-out tests cannot reach in practice.
  const url = response.url();
  const status = response.status();
  if (isFailureStatusCode(status)) {
    const preview = await safeBodyPreview(response);
    recordFailure(state, { status, url, bodyPreview: preview, classifier: 'http-4xx' });
    return true;
  }
  if (status !== 200) return true;
  const body = await safeParsedBody(response);
  if (body === NO_PARSED_BODY) return true;
  const note = classifyBodyAsFailure(body);
  if (note === false) return true;
  const bodyJson = JSON.stringify(body);
  const bodyJsonClipped = bodyJson.slice(0, BODY_PREVIEW_LIMIT);
  const previewRaw = `${note}: ${bodyJsonClipped}`;
  const previewMasked = maskVisibleText(previewRaw);
  recordFailure(state, { status, url, bodyPreview: previewMasked, classifier: 'body-error' });
  return true;
}

/**
 * Build the per-response handler closure. Returns a synchronous boolean
 * to satisfy the project's no-void rule; Playwright ignores the value.
 * @param state - Watcher state to update on detection.
 * @returns Playwright response listener.
 */
function buildResponseHandler(state: IWatcherState): (response: Response) => boolean {
  /**
   * Per-response listener. Synchronous shell; the JSON inspection runs in
   * a fire-and-forget Promise so the listener never returns a Promise to
   * Playwright (matches the existing handleResponse pattern).
   * @param response - Playwright response.
   * @returns Always true.
   */
  return (response: Response): boolean => {
    if (state.isDisposed) return false;
    if (state.detected) return false;
    const url = response.url();
    if (!isAuthEndpointUrl(url)) return false;
    inspectAuthResponse(state, response).catch((): boolean => false);
    return true;
  };
}

/**
 * Read state.detected through a function call so TS flow analysis cannot
 * narrow the value back to the literal `false` after an earlier early-
 * return check. Used to re-poll state across an `await` boundary.
 * @param state - Watcher state.
 * @returns Current detected value.
 */
function readDetected(state: IWatcherState): false | IAuthFailure {
  return state.detected;
}

/**
 * Awaitable wait — resolves with an existing failure synchronously,
 * otherwise uses Playwright's native event-driven `waitForResponse` to
 * wait for the next 4xx on an auth URL. The listener installed in
 * `createAuthFailureWatcher` may also have already populated state with
 * an L2 (body-error) hit while we waited.
 * @param page - Playwright page.
 * @param state - Watcher state.
 * @param timeoutMs - Max wait time.
 * @returns Failure record or false on timeout.
 */
async function awaitFailure(
  page: Page,
  state: IWatcherState,
  timeoutMs: number,
): Promise<IAuthFailure | false> {
  const detectedBefore = readDetected(state);
  if (detectedBefore) return detectedBefore;
  /**
   * Match next 4xx on a WK auth URL.
   * @param r - Playwright response.
   * @returns True for an auth URL with 4xx status.
   */
  const matcher = (r: Response): boolean => {
    const url = r.url();
    if (!isAuthEndpointUrl(url)) return false;
    const responseStatus = r.status();
    return isFailureStatusCode(responseStatus);
  };
  const next = await page
    .waitForResponse(matcher, { timeout: timeoutMs })
    .catch((): false => false);
  // Race: an L2 (body-error) hit may have populated state.detected
  // while we awaited. Re-read through readDetected to defeat the
  // narrowing established by the earlier early-return check.
  const detectedAfter = readDetected(state);
  if (detectedAfter) return detectedAfter;
  if (next === false) return false;
  const preview = await safeBodyPreview(next);
  const failure: IAuthFailure = {
    status: next.status(),
    url: next.url(),
    bodyPreview: preview,
    classifier: 'http-4xx',
  };
  recordFailure(state, failure);
  return failure;
}

/**
 * Build the public watcher API bound to the supplied page + state.
 * @param page - Playwright page.
 * @param state - Mutable watcher state.
 * @returns Public watcher object.
 */
function buildWatcherApi(page: Page, state: IWatcherState): IAuthFailureWatcher {
  /**
   * Reset captured state — used between retry attempts.
   * @returns True after reset.
   */
  const resetFn = (): boolean => {
    state.detected = false;
    return true;
  };
  /**
   * Stop listening to page responses; idempotent.
   * @returns True when this call performed the unsubscribe, false when
   * a prior dispose had already torn the watcher down (idempotent skip).
   */
  const disposeFn = (): boolean => {
    if (state.isDisposed) return false;
    state.isDisposed = true;
    page.off('response', state.responseHandler);
    return true;
  };
  /**
   * Wait for the next auth failure, bounded by timeoutMs.
   * @param timeoutMs - Max wait time.
   * @returns Failure record or false on timeout.
   */
  const waitFn = (timeoutMs: number): Promise<IAuthFailure | false> =>
    awaitFailure(page, state, timeoutMs);
  /**
   * Synchronously probe captured failure state.
   * @returns Failure record if any, else false.
   */
  const hasFailedFn = (): false | IAuthFailure => state.detected;
  return {
    waitForFailure: waitFn,
    hasFailed: hasFailedFn,
    reset: resetFn,
    dispose: disposeFn,
  };
}

/**
 * Subscribe to page responses and return a watcher tracking the first auth
 * failure of either layer. The watcher MUST be disposed when the LoginPhase
 * exits to prevent stale OTP-flow 4xx responses from polluting state.
 * @param page - Playwright page bound to the active scrape.
 * @returns Watcher API.
 */
function createAuthFailureWatcher(page: Page): IAuthFailureWatcher {
  /**
   * Placeholder handler used while the state is constructed; replaced
   * immediately below by the real listener. Exists only so the state's
   * responseHandler field can be non-nullable (so disposeFn never has
   * to guard the page.off call).
   * @returns Always true.
   */
  const placeholderHandler = (): boolean => true;
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
 * Build a no-op watcher for frozen-network contexts (SCRAPE phase) where
 * no live page exists. Always reports "not failed" / "timeout".
 * @returns Frozen watcher.
 */
function createFrozenAuthFailureWatcher(): IAuthFailureWatcher {
  /**
   * Stub timeout-only waiter for the frozen variant.
   * @returns Resolved promise of false.
   */
  const stubWait = (): Promise<IAuthFailure | false> => Promise.resolve(false);
  /**
   * Stub probe for the frozen variant.
   * @returns Always false.
   */
  const stubProbe = (): false => false;
  /**
   * Stub op for the frozen variant.
   * @returns Always true.
   */
  const stubOp = (): boolean => true;
  return {
    waitForFailure: stubWait,
    hasFailed: stubProbe,
    reset: stubOp,
    dispose: stubOp,
  };
}

export {
  AUTH_BODY_FAILURE_PATTERNS,
  classifyBodyAsFailure,
  createAuthFailureWatcher,
  createFrozenAuthFailureWatcher,
  isAuthEndpointUrl,
  isFailureStatusCode,
};
export type { AuthFailureClassifier, IAuthFailure, IAuthFailureWatcher, IBodyFailurePattern };
