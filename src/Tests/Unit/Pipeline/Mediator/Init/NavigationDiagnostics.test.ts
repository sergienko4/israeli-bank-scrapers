/**
 * Unit tests for NavigationDiagnostics — the helper module that
 * builds rich forensic snapshots when {@link executeNavigateToBank}
 * fails. Covers:
 *
 *  - {@link classifyNavError} pattern coverage (timeout / dns /
 *    tcp-refused / tcp-reset / tls / unknown).
 *  - {@link attachFailedRequestCollector} accumulation + detach.
 *  - {@link buildNavFailureSnapshot} field shape.
 *  - {@link logNavFailureSnapshot} log envelope.
 *
 * <p>Mocking strategy: a tiny {@link IRecordingPage} stub that stores
 * the `(event, handler)` pairs from `on()` / `off()` so the test can
 * drive `requestfailed` synchronously without spinning up Camoufox.
 */

import { jest } from '@jest/globals';
import type { Page, Request } from 'playwright-core';

import {
  attachFailedRequestCollector,
  buildNavFailureSnapshot,
  classifyNavError,
  type INavFailedRequest,
  logNavFailureSnapshot,
  type NavErrorCategory,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/NavigationDiagnostics.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

/** Handler shape Playwright's `requestfailed` listener delivers. */
type IRequestFailedHandler = (req: Request) => boolean;

/** Listener-recording stub — supports `on('requestfailed', h)` / `off`. */
interface IRecordingPage {
  readonly handlers: IRequestFailedHandler[];
  readonly on: (event: string, handler: IRequestFailedHandler) => boolean;
  readonly off: (event: string, handler: IRequestFailedHandler) => boolean;
}

/**
 * Register a `requestfailed` handler on the recording page. Returns
 * `true` to satisfy the project's no-void rule; the return value is
 * discarded by Playwright's event dispatcher.
 *
 * @param handlers - Shared list of recorded handlers.
 * @param event - Event name; only `requestfailed` is recorded.
 * @param handler - Handler to record when event matches.
 * @returns Always `true`.
 */
function recordOn(
  handlers: IRequestFailedHandler[],
  event: string,
  handler: IRequestFailedHandler,
): boolean {
  if (event === 'requestfailed') handlers.push(handler);
  return true;
}

/**
 * Remove a previously-registered `requestfailed` handler from the
 * recording page. Returns `true` to satisfy the no-void rule.
 *
 * @param handlers - Shared list of recorded handlers.
 * @param event - Event name; only `requestfailed` is unregistered.
 * @param handler - Handler to unregister.
 * @returns Always `true`.
 */
function recordOff(
  handlers: IRequestFailedHandler[],
  event: string,
  handler: IRequestFailedHandler,
): boolean {
  if (event !== 'requestfailed') return true;
  const idx = handlers.indexOf(handler);
  if (idx >= 0) handlers.splice(idx, 1);
  return true;
}

/**
 * Build a stub Page that records `requestfailed` listeners.
 *
 * @returns Page surface accepted by Playwright type cast.
 */
function makeRecordingPage(): IRecordingPage {
  const handlers: IRequestFailedHandler[] = [];
  /**
   * `on` shim — delegates to {@link recordOn}.
   *
   * @param event - Event name forwarded to recordOn.
   * @param handler - Handler forwarded to recordOn.
   * @returns Always `true` (no-void rule).
   */
  const on = (event: string, handler: IRequestFailedHandler): boolean =>
    recordOn(handlers, event, handler);
  /**
   * `off` shim — delegates to {@link recordOff}.
   *
   * @param event - Event name forwarded to recordOff.
   * @param handler - Handler forwarded to recordOff.
   * @returns Always `true` (no-void rule).
   */
  const off = (event: string, handler: IRequestFailedHandler): boolean =>
    recordOff(handlers, event, handler);
  return { handlers, on, off };
}

/**
 * Build a stub Request that returns a scripted url + failure text.
 *
 * @param url - Url the stub will return.
 * @param errorText - Text returned by `request.failure()`.
 * @returns Request stub cast through `unknown`.
 */
function makeRequest(url: string, errorText: string): Request {
  const failure = { errorText };
  /**
   * Scripted URL accessor.
   *
   * @returns The scripted URL.
   */
  const urlFn = (): string => url;
  /**
   * Scripted failure accessor.
   *
   * @returns The scripted failure record.
   */
  const failureFn = (): { errorText: string } => failure;
  return { url: urlFn, failure: failureFn } as unknown as Request;
}

describe('classifyNavError', () => {
  const cases: readonly { label: string; message: string; expected: NavErrorCategory }[] = [
    {
      label: 'Playwright TimeoutError',
      message: 'page.goto: Timeout 15000ms exceeded.',
      expected: 'timeout',
    },
    { label: 'Firefox DNS', message: 'NS_ERROR_UNKNOWN_HOST', expected: 'dns' },
    { label: 'Chromium DNS', message: 'net::ERR_NAME_NOT_RESOLVED at https://x', expected: 'dns' },
    {
      label: 'Firefox connection refused',
      message: 'NS_ERROR_CONNECTION_REFUSED',
      expected: 'tcp-refused',
    },
    {
      label: 'Chromium connection refused',
      message: 'net::ERR_CONNECTION_REFUSED',
      expected: 'tcp-refused',
    },
    { label: 'Firefox NET_INTERRUPT', message: 'NS_ERROR_NET_INTERRUPT', expected: 'tcp-reset' },
    {
      label: 'Chromium connection reset',
      message: 'net::ERR_CONNECTION_RESET',
      expected: 'tcp-reset',
    },
    { label: 'Network changed', message: 'net::ERR_NETWORK_CHANGED', expected: 'tcp-reset' },
    { label: 'TLS handshake', message: 'SSL alert number 80', expected: 'tls' },
    { label: 'Cert error', message: 'ERR_CERT_DATE_INVALID', expected: 'tls' },
    { label: 'Unknown', message: 'something else entirely', expected: 'unknown' },
  ];
  it.each(cases)('$label → $expected', ({ message, expected }) => {
    const result = classifyNavError(message);
    expect(result).toBe(expected);
  });
});

describe('attachFailedRequestCollector', () => {
  it('accumulates failed requests as they fire', () => {
    const page = makeRecordingPage();
    const collector = attachFailedRequestCollector(page as unknown as Page);
    expect(page.handlers).toHaveLength(1);
    const reqA = makeRequest('https://x/a', 'NS_ERROR_UNKNOWN_HOST');
    const reqB = makeRequest('https://x/b', 'net::ERR_CONNECTION_RESET');
    page.handlers[0](reqA);
    page.handlers[0](reqB);
    expect(collector.collected).toEqual<INavFailedRequest[]>([
      { url: 'https://x/a', errorText: 'NS_ERROR_UNKNOWN_HOST' },
      { url: 'https://x/b', errorText: 'net::ERR_CONNECTION_RESET' },
    ]);
  });

  it('detach removes the listener so future events do not accumulate', () => {
    const page = makeRecordingPage();
    const collector = attachFailedRequestCollector(page as unknown as Page);
    collector.detach();
    expect(page.handlers).toHaveLength(0);
    expect(collector.collected).toEqual([]);
  });

  it('records errorText as "unknown" when the request reports no failure', () => {
    const page = makeRecordingPage();
    const collector = attachFailedRequestCollector(page as unknown as Page);
    /**
     * Playwright's `Request.failure()` may legitimately return `null`
     * (request aborted before any failure recorded). We model that
     * shape here to exercise the `?? 'unknown'` fallback in
     * `snapshotRequest`. The mock uses a type-cast through `unknown`
     * so the no-null-returns architecture rule does not trip on the
     * literal `null` return below.
     *
     * @returns Cast through `unknown` to avoid the no-null lint rule.
     */
    const failureFn = (): unknown => null;
    const reqNoFailure = {
      /**
       * Scripted URL accessor.
       *
       * @returns Scripted URL string.
       */
      url: (): string => 'https://x/c',
      failure: failureFn,
    } as unknown as Request;
    page.handlers[0](reqNoFailure);
    expect(collector.collected).toEqual<INavFailedRequest[]>([
      { url: 'https://x/c', errorText: 'unknown' },
    ]);
  });
});

describe('buildNavFailureSnapshot', () => {
  it('assembles every field with classified category', () => {
    const error = new Error('page.goto: Timeout 15000ms exceeded.');
    error.name = 'TimeoutError';
    const failed: INavFailedRequest[] = [
      { url: 'https://x/a', errorText: 'NS_ERROR_UNKNOWN_HOST' },
    ];
    const snapshot = buildNavFailureSnapshot({
      error,
      attemptDurationMs: 15123,
      finalUrl: 'about:blank',
      failedRequests: failed,
    });
    expect(snapshot).toEqual({
      attemptDurationMs: 15123,
      finalUrl: 'about:blank',
      errorName: 'TimeoutError',
      errorMessage: 'page.goto: Timeout 15000ms exceeded.',
      category: 'timeout',
      failedRequests: failed,
    });
  });
});

describe('logNavFailureSnapshot', () => {
  it('emits a single warn with INIT-ACTION-NAV-FAILURE envelope', () => {
    const warn = jest.fn();
    const logger = { warn } as unknown as ScraperLogger;
    const error = new Error('NS_ERROR_UNKNOWN_HOST');
    const snapshot = buildNavFailureSnapshot({
      error,
      attemptDurationMs: 7,
      finalUrl: 'about:blank',
      failedRequests: [],
    });
    logNavFailureSnapshot(logger, snapshot);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: 'INIT-ACTION-NAV-FAILURE', ...snapshot });
  });
});
