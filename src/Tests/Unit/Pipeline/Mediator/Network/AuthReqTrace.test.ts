/**
 * Unit tests for gated AuthFailureWatcher request-level tracing.
 */

import type { Page, Request } from 'playwright-core';

import {
  AUTH_REQ_TRACE_ENV_VAR,
  createAuthFailureWatcher,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

type TraceEvent = 'response' | 'request' | 'requestfailed';
type RequestListener = (request: Request) => unknown;
type ResponseListener = (response: unknown) => unknown;
type AnyListener = RequestListener | ResponseListener;

interface ITraceLog {
  readonly event: string;
  readonly host: string;
  readonly method: string;
  readonly errorText?: string;
}

interface IMockPage {
  readonly handle: Page;
  readonly count: (event: TraceEvent) => number;
  readonly fireRequest: (request: Request) => boolean;
  readonly fireRequestFailed: (request: Request) => boolean;
}

/**
 * Build a logger that stores structured debug payloads.
 * @returns Logger plus captured payloads.
 */
function makeLogger(): { readonly logger: ScraperLogger; readonly logs: ITraceLog[] } {
  const logs: ITraceLog[] = [];
  /**
   * Capture one debug payload.
   * @param payload - Structured trace payload.
   * @returns True after storing.
   */
  const debug = (payload: ITraceLog): true => {
    logs.push(payload);
    return true;
  };
  const logger = { debug } as unknown as ScraperLogger;
  return { logger, logs };
}

/**
 * Build a minimal Page fake with on/off and event firing.
 * @returns Mock page helpers.
 */
function makePage(): IMockPage {
  const listeners: Record<TraceEvent, AnyListener[]> = {
    response: [],
    request: [],
    requestfailed: [],
  };
  /**
   * Register a fake page listener.
   * @param event - Event name.
   * @param listener - Listener callback.
   * @returns Page fake.
   */
  const on = (event: TraceEvent, listener: AnyListener): Page => {
    listeners[event].push(listener);
    return pageHandle;
  };
  /**
   * Remove a fake page listener.
   * @param event - Event name.
   * @param listener - Listener callback.
   * @returns Page fake.
   */
  const off = (event: TraceEvent, listener: AnyListener): Page => {
    listeners[event] = listeners[event].filter((entry): boolean => entry !== listener);
    return pageHandle;
  };
  const pageHandle = { on, off } as unknown as Page;
  return { handle: pageHandle, count, fireRequest, fireRequestFailed };

  /**
   * Count listeners for an event.
   * @param event - Event name.
   * @returns Registered listener count.
   */
  function count(event: TraceEvent): number {
    return listeners[event].length;
  }

  /**
   * Fire a request event.
   * @param request - Request payload.
   * @returns True after fan-out.
   */
  function fireRequest(request: Request): boolean {
    const callbacks = listeners.request;
    callbacks.forEach(listener => {
      listener(request);
    });
    return true;
  }

  /**
   * Fire a requestfailed event.
   * @param request - Request payload.
   * @returns True after fan-out.
   */
  function fireRequestFailed(request: Request): boolean {
    const callbacks = listeners.requestfailed;
    callbacks.forEach(listener => {
      listener(request);
    });
    return true;
  }
}

/**
 * Build a minimal Playwright Request fake.
 * @param url - Request URL.
 * @param method - HTTP method.
 * @param errorText - Optional network failure reason.
 * @returns Mock request.
 */
function makeRequest(url: string, method: string, errorText = 'net::ERR_ABORTED'): Request {
  /** Resolve the request URL.
   * @returns Request URL. */
  const urlFn = (): string => url;
  /** Resolve the request method.
   * @returns Request method. */
  const methodFn = (): string => method;
  /** Resolve the request failure.
   * @returns Request failure payload. */
  const failureFn = (): { readonly errorText: string } => ({ errorText });
  const request = { url: urlFn, method: methodFn, failure: failureFn };
  return request as unknown as Request;
}

/**
 * Cast used to produce a null at runtime while keeping the function's
 * declared return type non-null, satisfying the no-null-return ESLint rule.
 * Exercises the `failure()?.errorText ?? ''` null-coalescing branch.
 */
const NULL_FAILURE = null as unknown as { readonly errorText: string };

/**
 * Build a Request fake where failure() returns null (request did not fail
 * at the network layer — exercises the `?.errorText ?? ''` null branch
 * in emitRequestFailed).
 * @param url - Request URL.
 * @param method - HTTP method.
 * @returns Mock request with null failure record.
 */
function makeRequestNullFailure(url: string, method: string): Request {
  /** Resolve the request URL.
   * @returns Request URL. */
  const urlFn = (): string => url;
  /** Resolve the request method.
   * @returns Request method. */
  const methodFn = (): string => method;
  /** Returns NULL_FAILURE — null at runtime — to exercise the optional-chain null path.
   * @returns Typed-as-object null stand-in. */
  const failureFn = (): { readonly errorText: string } => NULL_FAILURE;
  const request = { url: urlFn, method: methodFn, failure: failureFn };
  return request as unknown as Request;
}

describe('AuthFailureWatcher request trace gate', () => {
  const previous = process.env[AUTH_REQ_TRACE_ENV_VAR];

  /**
   * Restore the trace env var after each test.
   * @returns True after restoration.
   */
  function restoreTraceEnv(): true {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = previous;
    return true;
  }

  afterEach(restoreTraceEnv);

  it('keeps request listeners detached when the gate is off', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '0';
    const mockPage = makePage();
    const { logger } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const responseCount = mockPage.count('response');
    const requestCount = mockPage.count('request');
    const failedCount = mockPage.count('requestfailed');
    expect(responseCount).toBe(1);
    expect(requestCount).toBe(0);
    expect(failedCount).toBe(0);

    watcher.dispose();
    const afterDispose = mockPage.count('response');
    expect(afterDispose).toBe(0);
  });

  it('logs failed WK auth requests and detaches every listener', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const analytics = makeRequest('https://api-js.mixpanel.com/track', 'POST');
    const auth = makeRequest('https://cards.example.test/api/v2/auth/login', 'POST');
    mockPage.fireRequestFailed(analytics);
    mockPage.fireRequestFailed(auth);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'login.authreq.failed',
      host: 'cards.example.test',
      method: 'POST',
      errorText: 'net::ERR_ABORTED',
    });

    watcher.dispose();
    const responseCount = mockPage.count('response');
    const requestCount = mockPage.count('request');
    const failedCount = mockPage.count('requestfailed');
    expect(responseCount).toBe(0);
    expect(requestCount).toBe(0);
    expect(failedCount).toBe(0);
  });

  it('logs failed Cloudflare JSD challenge requests under login.jsd.failed', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const jsd = makeRequest(
      'https://he.americanexpress.co.il/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js',
      'GET',
      'net::ERR_TIMED_OUT',
    );
    mockPage.fireRequestFailed(jsd);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'login.jsd.failed',
      host: 'he.americanexpress.co.il',
      method: 'GET',
      errorText: 'net::ERR_TIMED_OUT',
    });

    watcher.dispose();
  });

  it('emits login.authreq.sent for a matching WK auth request event', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const auth = makeRequest('https://cards.example.test/api/v2/auth/login', 'POST');
    mockPage.fireRequest(auth);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'login.authreq.sent',
      host: 'cards.example.test',
      method: 'POST',
    });

    watcher.dispose();
  });

  it('does not log non-WK request events', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const analytics = makeRequest('https://api-js.mixpanel.com/track', 'POST');
    mockPage.fireRequest(analytics);

    expect(logs).toHaveLength(0);

    watcher.dispose();
  });

  it('uses host "?" when the request URL cannot be parsed', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    // Relative URL (no scheme/host) satisfies the JSD path check but
    // makes new URL() throw → safeHost catch branch returns '?'.
    const jsd = makeRequest('/cdn-cgi/challenge-platform/test', 'GET');
    mockPage.fireRequestFailed(jsd);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'login.jsd.failed',
      host: '?',
      method: 'GET',
    });

    watcher.dispose();
  });

  it('uses empty errorText when the network failure record is absent', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makePage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    // failure() returns null → failure()?.errorText is undefined → errorText = ''
    const auth = makeRequestNullFailure('https://cards.example.test/api/v2/auth/login', 'POST');
    mockPage.fireRequestFailed(auth);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'login.authreq.failed',
      host: 'cards.example.test',
      method: 'POST',
      errorText: '',
    });

    watcher.dispose();
  });
});
