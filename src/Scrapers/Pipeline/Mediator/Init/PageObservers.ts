/**
 * L7 page-level observers for INIT-phase forensics. Mirrors the
 * {@link attachFailedRequestCollector} pattern in
 * {@link "./NavigationDiagnostics.js"}: each observer returns an
 * envelope of `{ collected | getResponse, detach }` so callers can
 * attach once at INIT start, read on failure, and detach in a
 * finally block. Returns `boolean` (no `void`) and uses
 * {@link Option} (no `null`/`undefined`) to satisfy project
 * architecture rules.
 *
 * <p>Why this exists (PR #289 follow-up). The Beinleumi CI
 * symptom is "page rendered (screenshot is back, no WAF banner)
 * but the OTP detector finds nothing." L4 probes (DNS/TCP/TLS)
 * report SUCCESS in that case — the failure is at L7 (page is
 * blank / non-interactive / loaded with the wrong layout). The
 * three observers in this module surface the L7 evidence the
 * triage step needs:
 *
 * <ul>
 *   <li><b>Frame tree</b>: enumerates all attached frames (name,
 *       url, isDetached) so a "page is just an empty shell of
 *       iframes" symptom is visible at a glance. Captured
 *       synchronously at failure time — no observer needed.</li>
 *   <li><b>Console error buffer</b>: subscribes to `page.on(
 *       'console')` filtered to errors and `page.on('pageerror')`
 *       for uncaught JS exceptions. A bank's frontend bundle
 *       failing CSP or a CORS preflight error never reaches the
 *       network layer but bubbles up as a console error.</li>
 *   <li><b>Landing response collector</b>: subscribes to
 *       `page.on('response')` and records the LAST top-level
 *       document response (status, statusText, URL, allow-listed
 *       headers, PII-redacted Set-Cookie). Reveals "page loaded
 *       with 200 but the body is a Cloudflare interstitial" or
 *       "bank returned 451/403 without a visible banner".</li>
 * </ul>
 *
 * <p>Per the "never throws; always resolves" contract used
 * throughout `Mediator/Init/`, every event handler swallows its
 * own exceptions — observability code MUST NOT crash the page
 * lifecycle. Detach handlers return `boolean` for the no-void rule.
 */

import type { ConsoleMessage, Frame, Page, Response } from 'playwright-core';

import { toError } from '../../Types/ErrorUtils.js';
import { none, type Option, some } from '../../Types/Option.js';
import { readInitForensicsGate } from './InitForensicsGate.js';

/** Snapshot of a single frame in the page's frame tree. */
export interface IFrameInfo {
  readonly name: string;
  readonly url: string;
  readonly isDetached: boolean;
}

/** Source of a console error entry. */
export type ConsoleErrorSource = 'console' | 'pageerror';

/** Single console-error entry captured by {@link attachConsoleErrorBuffer}. */
export interface IConsoleErrorEntry {
  readonly source: ConsoleErrorSource;
  readonly text: string;
  readonly location: string;
}

/**
 * Snapshot of a single response captured by
 * {@link attachLandingResponseCollector}. Only allow-listed
 * headers are kept; Set-Cookie values are PII-redacted to cookie
 * names only.
 */
export interface IResponseInfo {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Handle returned by {@link attachConsoleErrorBuffer}. */
export interface IConsoleErrorBuffer {
  readonly collected: readonly IConsoleErrorEntry[];
  readonly detach: () => boolean;
}

/** Handle returned by {@link attachLandingResponseCollector}. */
export interface ILandingResponseCollector {
  readonly getResponse: () => Option<IResponseInfo>;
  readonly detach: () => boolean;
}

/** Sentinel for an unavailable console error source location. */
const NO_LOCATION = '';
/** Allow-listed response headers preserved by the landing collector. */
const RESPONSE_HEADER_ALLOWLIST: readonly string[] = Object.freeze([
  'set-cookie',
  'content-security-policy',
  'cf-ray',
  'x-frame-options',
  'content-length',
  'content-type',
  'server',
]);
/** Header name that always triggers PII redaction. */
const SET_COOKIE_HEADER = 'set-cookie';
/** Sentinel substituted for raw Set-Cookie values. */
const REDACTED_COOKIE_VALUE = '<redacted>';
/** Playwright `resourceType` value for top-level navigation documents. */
const DOCUMENT_RESOURCE_TYPE = 'document';
/** Playwright `ConsoleMessage.type()` value we keep in the buffer. */
const ERROR_CONSOLE_TYPE = 'error';

/**
 * Project a Playwright {@link Frame} into the snapshot row. Pulled
 * out so {@link captureFrameTree} stays ≤10 LoC.
 *
 * @param frame - Frame from `page.frames()`.
 * @returns Frame snapshot row.
 */
function snapshotFrame(frame: Frame): IFrameInfo {
  return { name: frame.name(), url: frame.url(), isDetached: frame.isDetached() };
}

/**
 * Enumerate all frames currently attached to the page (incl. the
 * main frame and any iframes). Synchronous — relies on the
 * already-populated `page.frames()` accessor; no awaits. Returns an
 * empty array if the page accessor throws (never-throws contract).
 * Gated by {@link readInitForensicsGate}: when forensics are OFF
 * the call returns the empty sentinel without touching the page.
 *
 * @param page - Playwright page.
 * @returns Read-only list of frame snapshots.
 */
export function captureFrameTree(page: Page): readonly IFrameInfo[] {
  const gate = readInitForensicsGate();
  if (!gate.enabled) return EMPTY_FRAMES;
  try {
    return page.frames().map(snapshotFrame);
  } catch {
    return EMPTY_FRAMES;
  }
}

/** Frozen empty list returned by {@link captureFrameTree} on no-op / failure. */
const EMPTY_FRAMES: readonly IFrameInfo[] = Object.freeze([]);

/**
 * Format the `location()` accessor result into a stable
 * `url:line:col` string. Returns the {@link NO_LOCATION} sentinel
 * on any error (never-throws contract).
 *
 * @param msg - Playwright console message.
 * @returns Formatted location string.
 */
function formatConsoleLocation(msg: ConsoleMessage): string {
  try {
    const loc = msg.location();
    return `${loc.url}:${String(loc.lineNumber)}:${String(loc.columnNumber)}`;
  } catch {
    return NO_LOCATION;
  }
}

/**
 * Convert a Playwright {@link ConsoleMessage} into the snapshot
 * entry shape.
 *
 * @param msg - Playwright console message.
 * @returns Console entry snapshot.
 */
function snapshotConsoleMessage(msg: ConsoleMessage): IConsoleErrorEntry {
  const location = formatConsoleLocation(msg);
  return { source: 'console', text: msg.text(), location };
}

/**
 * Convert a thrown `pageerror` value into the snapshot entry shape.
 * `pageerror` always emits an {@link Error}-like object; we route
 * through {@link toError} for the same cross-realm hardening
 * applied elsewhere in the pipeline.
 *
 * @param error - Uncaught error value from `pageerror`.
 * @returns Page-error entry snapshot.
 */
function snapshotPageError(error: unknown): IConsoleErrorEntry {
  const normalised = toError(error);
  return { source: 'pageerror', text: normalised.message, location: NO_LOCATION };
}

/**
 * Append an entry to the collector accumulator. Pulled out so the
 * handler factories below can avoid nested calls inside `push(...)`
 * (the project's no-nested-call rule forbids
 * `collected.push(snapshot(...))`).
 *
 * @param collected - Mutable accumulator.
 * @param entry - Entry to append.
 * @returns `true` to satisfy the no-void rule.
 */
function appendConsoleEntry(collected: IConsoleErrorEntry[], entry: IConsoleErrorEntry): boolean {
  collected.push(entry);
  return true;
}

/**
 * Build the `console` event handler that appends error-level
 * messages to the collector accumulator. Non-error console output
 * (info, warn, debug) is dropped immediately at the handler level.
 *
 * @param collected - Mutable accumulator.
 * @returns Handler returning `true` per the no-void rule.
 */
function makeConsoleHandler(collected: IConsoleErrorEntry[]): (msg: ConsoleMessage) => boolean {
  return (msg: ConsoleMessage): boolean => {
    if (msg.type() !== ERROR_CONSOLE_TYPE) return false;
    const entry = snapshotConsoleMessage(msg);
    return appendConsoleEntry(collected, entry);
  };
}

/**
 * Build the `pageerror` event handler that appends uncaught-JS
 * errors to the collector accumulator. Mirrors
 * {@link makeConsoleHandler}.
 *
 * @param collected - Mutable accumulator.
 * @returns Handler returning `true` per the no-void rule.
 */
function makePageErrorHandler(collected: IConsoleErrorEntry[]): (error: Error) => boolean {
  return (error: Error): boolean => {
    const entry = snapshotPageError(error);
    return appendConsoleEntry(collected, entry);
  };
}

/** Bundle passed to {@link makeConsoleDetach} (`max-params: 3`). */
interface IConsoleBufferDeps {
  readonly page: Page;
  readonly consoleHandler: (msg: ConsoleMessage) => boolean;
  readonly pageErrorHandler: (error: Error) => boolean;
}

/**
 * Build the disposer that removes BOTH the `console` and the
 * `pageerror` handlers in one call. Returns `true` after detach.
 *
 * @param input - Handlers and page bundle.
 * @returns Disposer function returning `true`.
 */
function makeConsoleDetach(input: IConsoleBufferDeps): () => boolean {
  return (): boolean => {
    input.page.off('console', input.consoleHandler);
    input.page.off('pageerror', input.pageErrorHandler);
    return true;
  };
}

/**
 * No-op detach used by both NOOP sentinels. Singleton so identity
 * comparison in tests asserts the gate-OFF code path.
 *
 * @returns Always `true`.
 */
function noopDetach(): boolean {
  return true;
}

/**
 * No-op `getResponse` for the landing-collector NOOP sentinel.
 *
 * @returns Always `none()`.
 */
function noopGetResponse(): Option<IResponseInfo> {
  return none();
}

/** No-op {@link IConsoleErrorBuffer} returned when forensics are OFF. */
const NOOP_CONSOLE_BUFFER: IConsoleErrorBuffer = Object.freeze({
  collected: Object.freeze([]),
  detach: noopDetach,
});

/**
 * Wire the real `console` + `pageerror` handlers onto the page.
 * Extracted from {@link attachConsoleErrorBuffer} so the public
 * function stays ≤10 LoC after adding the forensics gate.
 *
 * @param page - Playwright page.
 * @returns Live console-error buffer subscribed to the page.
 */
function attachConsoleErrorBufferReal(page: Page): IConsoleErrorBuffer {
  const collected: IConsoleErrorEntry[] = [];
  const consoleHandler = makeConsoleHandler(collected);
  const pageErrorHandler = makePageErrorHandler(collected);
  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);
  const detach = makeConsoleDetach({ page, consoleHandler, pageErrorHandler });
  return { collected, detach };
}

/**
 * Attach a console-error buffer to the page. Subscribes to both
 * `page.on('console')` (filtered to errors) and `page.on(
 * 'pageerror')` so any L7 JS or CSP failure is captured. Caller
 * MUST invoke `detach()` in a finally block. Gated by
 * {@link readInitForensicsGate}: when forensics are OFF the
 * function attaches no listeners and returns the
 * {@link NOOP_CONSOLE_BUFFER} sentinel (zero detection surface).
 *
 * @param page - Playwright page.
 * @returns Handle exposing the growing buffer and disposer.
 */
export function attachConsoleErrorBuffer(page: Page): IConsoleErrorBuffer {
  const gate = readInitForensicsGate();
  if (!gate.enabled) return NOOP_CONSOLE_BUFFER;
  return attachConsoleErrorBufferReal(page);
}

/**
 * Redact a Set-Cookie value down to the cookie NAME, dropping the
 * value, the path, the expires, etc. Per the project's PII rules
 * we never log raw cookie values — cookie names alone are enough
 * to diagnose "WAF dropped its session token cookie".
 *
 * @param raw - Raw Set-Cookie header value.
 * @returns Redacted form `<name>=<redacted>`.
 */
function redactSetCookie(raw: string): string {
  const firstAttr = raw.split(';', 1)[0] ?? '';
  const name = firstAttr.split('=', 1)[0] ?? '';
  if (name === '') return REDACTED_COOKIE_VALUE;
  return `${name}=${REDACTED_COOKIE_VALUE}`;
}

/**
 * Project a single allow-listed header into a redacted value. The
 * `set-cookie` header is funnelled through {@link redactSetCookie};
 * other allow-listed headers pass through unchanged.
 *
 * @param key - Allow-listed header name.
 * @param value - Raw header value.
 * @returns Snapshot-shape value.
 */
function projectHeaderValue(key: string, value: string): string {
  if (key === SET_COOKIE_HEADER) return redactSetCookie(value);
  return value;
}

/** Bundle passed to {@link reduceAllowedHeader} (`max-params: 3`). */
interface IHeaderReduceContext {
  readonly raw: Record<string, string>;
}

/**
 * Reducer step: copy ONE allow-listed header from `raw` into the
 * accumulator. Returns the same accumulator (mutated) so callers
 * can chain into {@link Array.prototype.reduce}.
 *
 * @param acc - Output accumulator (mutated in place).
 * @param key - Allow-listed header name under inspection.
 * @param ctx - Context bundle holding the raw headers map.
 * @returns The same accumulator after potential mutation.
 */
function reduceAllowedHeader(
  acc: Record<string, string>,
  key: string,
  ctx: IHeaderReduceContext,
): Record<string, string> {
  if (!Object.hasOwn(ctx.raw, key)) return acc;
  const value = ctx.raw[key];
  acc[key] = projectHeaderValue(key, value);
  return acc;
}

/**
 * Project the allow-listed headers, PII-redacting Set-Cookie.
 * Implemented as a reduce so the function body stays flat (no
 * `for` + `if` nesting that would trip the project's max-depth: 1
 * rule).
 *
 * @param raw - Raw headers map from `response.headers()`.
 * @returns Projected snapshot-shaped headers map.
 */
function projectAllowedHeaders(raw: Record<string, string>): Record<string, string> {
  const ctx: IHeaderReduceContext = { raw };
  const seed: Record<string, string> = {};
  return RESPONSE_HEADER_ALLOWLIST.reduce((acc, key) => reduceAllowedHeader(acc, key, ctx), seed);
}

/**
 * Snapshot a Playwright {@link Response} into the
 * {@link IResponseInfo} shape, wrapped as an {@link Option} so a
 * failure to snapshot resolves to `none()` rather than `undefined`.
 * All accessors are synchronous; the try/catch honours the
 * never-throws contract.
 *
 * @param response - Playwright response.
 * @returns Response snapshot wrapped in Option.
 */
function snapshotResponse(response: Response): Option<IResponseInfo> {
  try {
    const info = buildResponseInfo(response);
    return some(info);
  } catch {
    return none();
  }
}

/**
 * Build the {@link IResponseInfo} for a successful snapshot. Pulled
 * out so {@link snapshotResponse} stays ≤10 LoC and the four
 * accessor reads have a single audit point.
 *
 * @param response - Playwright response (assumed not closed).
 * @returns Response info row.
 */
function buildResponseInfo(response: Response): IResponseInfo {
  const rawHeaders = response.headers();
  const headers = projectAllowedHeaders(rawHeaders);
  const url = response.url();
  const status = response.status();
  const statusText = response.statusText();
  return { url, status, statusText, headers };
}

/**
 * Filter predicate selecting top-level document responses (the
 * landing page after all redirects). Skips sub-resources (images,
 * scripts, fetch, etc.) and iframe documents. Wraps
 * {@link isLandingResponseUnsafe} so an accessor throw resolves to
 * `false` (never-throws contract).
 *
 * @param response - Playwright response under inspection.
 * @param page - Page the observer is attached to (for main-frame check).
 * @returns True if the response is the landing document.
 */
function isLandingResponse(response: Response, page: Page): boolean {
  try {
    return isLandingResponseUnsafe(response, page);
  } catch {
    return false;
  }
}

/**
 * Inner predicate that assumes accessors will not throw. Split out
 * so {@link isLandingResponse} keeps its try-block flat (the
 * project's max-depth: 1 rule forbids `if` inside `try`).
 *
 * @param response - Playwright response under inspection.
 * @param page - Page the observer is attached to.
 * @returns True if the response is the landing document.
 */
function isLandingResponseUnsafe(response: Response, page: Page): boolean {
  const request = response.request();
  if (request.resourceType() !== DOCUMENT_RESOURCE_TYPE) return false;
  return request.frame() === page.mainFrame();
}

/** Mutable single-slot holder for the latest landing response snapshot. */
interface IResponseRef {
  value: Option<IResponseInfo>;
}

/** Bundle passed to {@link makeResponseHandler} (`max-params: 3`). */
interface IResponseHandlerDeps {
  readonly page: Page;
  readonly ref: IResponseRef;
}

/**
 * Build the `response` event handler that updates a mutable ref
 * with the LAST top-level document response. We filter to
 * `resourceType === 'document'` AND `frame === mainFrame` so the
 * captured response is always the landing page, not a sub-resource.
 *
 * @param input - Mutable ref + page bundle.
 * @returns Handler returning `true` per the no-void rule.
 */
function makeResponseHandler(input: IResponseHandlerDeps): (response: Response) => boolean {
  return (response: Response): boolean => {
    if (!isLandingResponse(response, input.page)) return false;
    input.ref.value = snapshotResponse(response);
    return true;
  };
}

/**
 * Build the disposer that removes the `response` handler. Returns
 * `true` after detach.
 *
 * @param page - Page the handler was registered on.
 * @param handler - Handler to remove.
 * @returns Disposer function returning `true`.
 */
function makeResponseDetach(page: Page, handler: (response: Response) => boolean): () => boolean {
  return (): boolean => {
    page.off('response', handler);
    return true;
  };
}

/**
 * Build the getter that reads the current value from the response
 * ref. Extracted so {@link attachLandingResponseCollector} stays
 * ≤10 LoC and the inline arrow has a JSDoc audit point.
 *
 * @param ref - Mutable response ref.
 * @returns Reader function returning the current snapshot Option.
 */
function makeResponseGetter(ref: IResponseRef): () => Option<IResponseInfo> {
  return (): Option<IResponseInfo> => ref.value;
}

/** No-op {@link ILandingResponseCollector} returned when forensics are OFF. */
const NOOP_LANDING_COLLECTOR: ILandingResponseCollector = Object.freeze({
  getResponse: noopGetResponse,
  detach: noopDetach,
});

/**
 * Wire the real `response` handler onto the page. Extracted from
 * {@link attachLandingResponseCollector} so the public function
 * stays ≤10 LoC after adding the forensics gate.
 *
 * @param page - Playwright page.
 * @returns Live landing-response collector subscribed to the page.
 */
function attachLandingResponseCollectorReal(page: Page): ILandingResponseCollector {
  const ref: IResponseRef = { value: none() };
  const handler = makeResponseHandler({ page, ref });
  page.on('response', handler);
  const detach = makeResponseDetach(page, handler);
  const getResponse = makeResponseGetter(ref);
  return { getResponse, detach };
}

/**
 * Attach a landing-response collector to the page. Records the
 * LAST top-level document response — across all redirects, the
 * final landing page is what diagnoses "200 but WAF interstitial"
 * vs "451 with no banner". Caller MUST invoke `detach()` in a
 * finally block. Gated by {@link readInitForensicsGate}: when
 * forensics are OFF the function attaches no listeners and returns
 * the {@link NOOP_LANDING_COLLECTOR} sentinel.
 *
 * @param page - Playwright page.
 * @returns Handle exposing `getResponse()` and disposer.
 */
export function attachLandingResponseCollector(page: Page): ILandingResponseCollector {
  const gate = readInitForensicsGate();
  if (!gate.enabled) return NOOP_LANDING_COLLECTOR;
  return attachLandingResponseCollectorReal(page);
}

export { NO_LOCATION, REDACTED_COOKIE_VALUE, RESPONSE_HEADER_ALLOWLIST };
