/**
 * Unit tests — gated deep login forensic trace handlers.
 *
 * Covers:
 *   buildPageErrorHandler — login.pageerror with scrubbed message
 *   buildConsoleHandler   — login.console (error/warning only; log/info silent)
 *   buildPopupHandler     — login.target.new with host-only URL
 *   login.req.seen        — all-request trace integration (RED before emit, GREEN after)
 *   gate-OFF              — zero new listeners attached (byte-identical production)
 */

import type { ConsoleMessage, Page, Request } from 'playwright-core';

import {
  AUTH_REQ_TRACE_ENV_VAR,
  createAuthFailureWatcher,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js';
import {
  buildConsoleHandler,
  buildPageErrorHandler,
  buildPopupHandler,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/LoginForensicTrace.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Payload shape captured by the mock logger's debug calls. */
interface ITraceLog {
  readonly event: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Shared factories
// ---------------------------------------------------------------------------

/**
 * Build a logger that stores structured debug payloads.
 * @returns Logger plus captured payloads array.
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
  return { logger: { debug } as unknown as ScraperLogger, logs };
}

/**
 * Build a minimal ConsoleMessage fake.
 * @param type - Message type string (e.g. 'error', 'log').
 * @param text - Message text.
 * @returns ConsoleMessage stub.
 */
function makeConsoleMessage(type: string, text: string): ConsoleMessage {
  /**
   * Type accessor.
   * @returns Message type.
   */
  const typeFn = (): string => type;
  /**
   * Text accessor.
   * @returns Message text.
   */
  const textFn = (): string => text;
  return { type: typeFn, text: textFn } as unknown as ConsoleMessage;
}

/**
 * Build a minimal popup Page fake.
 * @param url - Page URL string.
 * @returns Page stub.
 */
function makePopupPage(url: string): Page {
  /**
   * URL accessor.
   * @returns Page URL.
   */
  const urlFn = (): string => url;
  return { url: urlFn } as unknown as Page;
}

/**
 * Build a minimal Page fake with url() and frames() for buildConsoleHandler tests.
 * @param url - Page URL string.
 * @returns Page stub with empty frame list.
 */
function makeSimplePage(url = 'https://he.example.co.il/'): Page {
  /**
   * URL accessor.
   * @returns Page URL.
   */
  const urlFn = (): string => url;
  /**
   * Frames accessor.
   * @returns Empty frame list.
   */
  const framesFn = (): never[] => [];
  return { url: urlFn, frames: framesFn } as unknown as Page;
}

/**
 * Build a minimal Playwright Request fake with resourceType support.
 * @param url - Request URL.
 * @param method - HTTP method.
 * @param resourceType - Resource type (default 'fetch').
 * @returns Request stub.
 */
function makeRequest(url: string, method: string, resourceType = 'fetch'): Request {
  /** Request URL accessor.
   * @returns The URL string. */
  const urlFn = (): string => url;
  /** Request method accessor.
   * @returns The HTTP method. */
  const methodFn = (): string => method;
  /** Request resource type accessor.
   * @returns The resource type. */
  const resourceTypeFn = (): string => resourceType;
  /** Request failure accessor.
   * @returns Failure record with empty errorText. */
  const failureFn = (): { readonly errorText: string } => ({ errorText: '' });
  return {
    url: urlFn,
    method: methodFn,
    resourceType: resourceTypeFn,
    failure: failureFn,
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Full-page mock for wiring / gate-OFF tests
// ---------------------------------------------------------------------------

type PageEventName = 'response' | 'request' | 'requestfailed' | 'console' | 'pageerror';
type AnyHandler = (arg: unknown) => unknown;

interface IMockCtx {
  /** Calls recorded by context.on, keyed by event. */
  readonly calls: string[];
  /** Remove a listener from the context. */
  readonly off: (event: string, handler: AnyHandler) => boolean;
  /** Listener count on 'page' event. */
  readonly pageCount: () => number;
}

interface IMockFullPage {
  /** Handle to pass to createAuthFailureWatcher. */
  readonly handle: Page;
  /** Count of registered listeners for a page event. */
  readonly count: (ev: PageEventName) => number;
  /** Events passed to page.on, in registration order. */
  readonly onCalls: string[];
  /** Simulate a 'request' event fire. */
  readonly fireRequest: (req: Request) => boolean;
  /** Expose context mock for assertion. */
  readonly ctx: IMockCtx;
}

/** Context state built by makeCtxState for use in makeMockPage. */
interface ICtxState {
  readonly ctx: IMockCtx;
  readonly ctxFull: {
    readonly on: (e: string, h: AnyHandler) => boolean;
    readonly off: (e: string, h: AnyHandler) => boolean;
  };
}

/**
 * Build shared context-level listener state for makeMockPage.
 * @returns ctx mock for assertions + ctxFull mock for page.context().
 */
function makeCtxState(): ICtxState {
  const ctxCalls: string[] = [];
  const ctxPageListeners: AnyHandler[] = [];
  /**
   * Remove a page listener from context.
   * @param event - Event name.
   * @param handler - Handler to remove.
   * @returns True when removed.
   */
  const ctxOff = (event: string, handler: AnyHandler): boolean => {
    if (event !== 'page') return false;
    const i = ctxPageListeners.indexOf(handler);
    if (i >= 0) ctxPageListeners.splice(i, 1);
    return i >= 0;
  };
  /**
   * Count popup page listeners.
   * @returns Listener count.
   */
  const pageCount = (): number => ctxPageListeners.length;
  const ctx: IMockCtx = { calls: ctxCalls, off: ctxOff, pageCount };
  /**
   * Register a context-level listener.
   * @param event - Event name.
   * @param handler - Handler to register.
   * @returns True after registration.
   */
  const ctxOn = (event: string, handler: AnyHandler): boolean => {
    ctxCalls.push(event);
    if (event === 'page') ctxPageListeners.push(handler);
    return true;
  };
  const ctxFull = { on: ctxOn, off: ctxOff };
  return { ctx, ctxFull };
}

/**
 * Build a page mock with full context support for wiring / gate-OFF tests.
 * @returns Mock page helpers.
 */
function makeMockPage(): IMockFullPage {
  const pageListeners: Record<PageEventName, AnyHandler[]> = {
    response: [],
    request: [],
    requestfailed: [],
    console: [],
    pageerror: [],
  };
  const onCalls: string[] = [];
  const { ctx, ctxFull } = makeCtxState();
  /**
   * Register a page listener.
   * @param event - Page event name.
   * @param handler - Event handler.
   * @returns Page handle.
   */
  const on = (event: string, handler: AnyHandler): Page => {
    onCalls.push(event);
    if (event in pageListeners) pageListeners[event as PageEventName].push(handler);
    return pageHandle;
  };
  /**
   * Remove a page listener.
   * @param event - Page event name.
   * @param handler - Event handler.
   * @returns Page handle.
   */
  const off = (event: string, handler: AnyHandler): Page => {
    if (event in pageListeners) {
      pageListeners[event as PageEventName] = pageListeners[event as PageEventName].filter(
        h => h !== handler,
      );
    }
    return pageHandle;
  };
  /**
   * Return the browser context fake.
   * @returns Context fake.
   */
  const context = (): typeof ctxFull => ctxFull;
  const pageHandle = { on, off, context } as unknown as Page;
  /**
   * Count registered page listeners for one event.
   * @param ev - Event name.
   * @returns Listener count.
   */
  const countFn = (ev: PageEventName): number => pageListeners[ev].length;
  /**
   * Fire the request event to all registered listeners.
   * @param req - Request to dispatch.
   * @returns True after fan-out.
   */
  const fireRequestFn = (req: Request): boolean => {
    pageListeners.request.forEach(h => {
      h(req);
    });
    return true;
  };
  return { handle: pageHandle, count: countFn, onCalls, fireRequest: fireRequestFn, ctx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPageErrorHandler', () => {
  it('emits login.pageerror with scrubbed message and error name', () => {
    const { logger, logs } = makeLogger();
    const handler = buildPageErrorHandler(logger);
    const err = new Error('token 1234567 failed');
    err.name = 'TypeError';
    handler(err);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.pageerror', name: 'TypeError' });
    expect((logs[0] as unknown as { msgScrubbed: string }).msgScrubbed).not.toMatch(/\d{4}/);
    expect((logs[0] as unknown as { msgScrubbed: string }).msgScrubbed).toContain('#');
  });

  it('does not log the stack trace', () => {
    const { logger, logs } = makeLogger();
    const handler = buildPageErrorHandler(logger);
    handler(new Error('boom'));
    const payload = JSON.stringify(logs[0]);
    expect(payload).not.toContain('stack');
    expect(payload).not.toContain('at ');
  });
});

describe('buildConsoleHandler', () => {
  it('emits login.console for console error type', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', 'Auth failed');
    handler(msg);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.console', type: 'error' });
  });

  it('emits login.console for console warning type', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('warning', 'Deprecated usage');
    handler(msg);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.console', type: 'warning' });
  });

  it('suppresses console log type (noise)', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('log', 'Normal log');
    handler(msg);
    expect(logs).toHaveLength(0);
  });

  it('suppresses console info type (noise)', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('info', 'Info message');
    handler(msg);
    expect(logs).toHaveLength(0);
  });

  it('suppresses console debug type (noise)', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('debug', 'Debug info');
    handler(msg);
    expect(logs).toHaveLength(0);
  });

  it('scrubs digit-runs in the console text', () => {
    const { logger, logs } = makeLogger();
    const page = makeSimplePage();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', 'Session 9876543 expired');
    handler(msg);
    expect((logs[0] as unknown as { textScrubbed: string }).textScrubbed).not.toMatch(/\d{4}/);
    expect((logs[0] as unknown as { textScrubbed: string }).textScrubbed).toContain('#');
  });
});

describe('buildPopupHandler', () => {
  it('emits login.target.new with host for a normal URL', () => {
    const { logger, logs } = makeLogger();
    const handler = buildPopupHandler(logger);
    const popup = makePopupPage('https://he.americanexpress.co.il/popup');
    handler(popup);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.target.new', host: 'he.americanexpress.co.il' });
  });

  it('emits login.target.new with (opaque) for about:blank', () => {
    const { logger, logs } = makeLogger();
    const handler = buildPopupHandler(logger);
    const popup = makePopupPage('about:blank');
    handler(popup);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.target.new', host: '(opaque)' });
  });

  it('emits login.target.new with (opaque) for an unparseable URL', () => {
    const { logger, logs } = makeLogger();
    const handler = buildPopupHandler(logger);
    const popup = makePopupPage('not a valid url');
    handler(popup);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.target.new', host: '(opaque)' });
  });
});

describe('login.req.seen — all-request integration (RED→GREEN proof)', () => {
  const prev = process.env[AUTH_REQ_TRACE_ENV_VAR];

  afterEach(() => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = prev;
  });

  it('emits login.req.seen for a non-WK analytics request (gate ON)', () => {
    // This test was RED before handleAuthRequest gained the login.req.seen emit.
    // It is GREEN after the emit is added. Classifies fork-B: does ANY request
    // egress from the Amex login page after submit?
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '1';
    const mockPage = makeMockPage();
    const { logger, logs } = makeLogger();
    const watcher = createAuthFailureWatcher(mockPage.handle, logger);

    const analytics = makeRequest('https://www.google-analytics.com/g/collect', 'GET', 'fetch');
    mockPage.fireRequest(analytics);

    const hasSeen = logs.some(l => l.event === 'login.req.seen');
    expect(hasSeen).toBe(true);
    const seen = logs.find(l => l.event === 'login.req.seen');
    expect(seen).toMatchObject({
      event: 'login.req.seen',
      host: 'www.google-analytics.com',
      method: 'GET',
      resourceType: 'fetch',
    });

    watcher.dispose();
  });
});

describe('gate-OFF — zero new listeners (byte-identical production guarantee)', () => {
  const prev = process.env[AUTH_REQ_TRACE_ENV_VAR];

  afterEach(() => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = prev;
  });

  it('attaches no console, pageerror, or popup listeners when gate is OFF', () => {
    process.env[AUTH_REQ_TRACE_ENV_VAR] = '0';
    const mockPage = makeMockPage();
    const { logger } = makeLogger();

    createAuthFailureWatcher(mockPage.handle, logger);

    // page.on was called exactly once (for 'response' — always-on); no console/pageerror
    const hasConsole = mockPage.onCalls.includes('console');
    expect(hasConsole).toBe(false);
    const hasPageError = mockPage.onCalls.includes('pageerror');
    expect(hasPageError).toBe(false);
    // context.on was never called → no popup listener
    const hasPage = mockPage.ctx.calls.includes('page');
    expect(hasPage).toBe(false);
    // Sanity: response was attached
    const hasResponse = mockPage.onCalls.includes('response');
    expect(hasResponse).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D1 helpers — frame-inventory Page fakes
// ---------------------------------------------------------------------------

/**
 * Build a minimal frame stub with a url() accessor for D1 tests.
 * @param frameUrl - Frame URL string.
 * @returns Frame stub with url accessor.
 */
function makeFrame(frameUrl: string): { url(): string } {
  /**
   * Frame URL accessor.
   * @returns Frame URL string.
   */
  const urlFn = (): string => frameUrl;
  return { url: urlFn };
}

/**
 * Build a Page fake with url() and a populated frames() list for D1 tests.
 * @param mainUrl - Main frame URL.
 * @param frameUrls - Additional frame URLs to include.
 * @returns Page stub with url and frames accessors.
 */
function makePageWithFrames(mainUrl: string, frameUrls: readonly string[]): Page {
  /**
   * Main URL accessor.
   * @returns Main frame URL.
   */
  const urlFn = (): string => mainUrl;
  /**
   * Frames accessor — includes main frame + additional frames.
   * @returns Array of frame stubs.
   */
  const framesFn = (): { url(): string }[] => [mainUrl, ...frameUrls].map(makeFrame);
  return { url: urlFn, frames: framesFn } as unknown as Page;
}

// ---------------------------------------------------------------------------
// D1 — frame inventory + main URL on postMessage failure
// ---------------------------------------------------------------------------

describe('buildConsoleHandler D1 — login.frames snapshot on postMessage error', () => {
  /** Realistic cross-origin postMessage error text from Amex CI. */
  const pmText =
    "Failed to execute 'postMessage' on 'Window': The target origin " +
    "('https://web.americanexpress.co.il') does not match the recipient " +
    "window's origin ('https://he.americanexpress.co.il').";

  it('emits login.frames on the first cross-origin postMessage error', () => {
    const page = makePageWithFrames('https://he.americanexpress.co.il/personalarea/login/', [
      'https://web.americanexpress.co.il/auth-frame',
    ]);
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', pmText);
    handler(msg);
    const frameLog = logs.find(l => l.event === 'login.frames') as unknown as {
      event: string;
      mainUrl: string;
      hosts: readonly string[];
    };
    expect(frameLog).toBeDefined();
    expect(frameLog.hosts).toContain('he.americanexpress.co.il');
    expect(frameLog.hosts).toContain('web.americanexpress.co.il');
    expect(frameLog.mainUrl).toBe('he.americanexpress.co.il/personalarea/login/');
  });

  it('does NOT emit login.frames for a non-postMessage error', () => {
    const page = makeSimplePage('https://he.americanexpress.co.il/login/');
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', 'Uncaught TypeError: angularApp is undefined');
    handler(msg);
    const hasFramesEvent = logs.some(l => l.event === 'login.frames');
    expect(hasFramesEvent).toBe(false);
  });

  it('emits login.frames exactly ONCE even after two postMessage errors (dedupe)', () => {
    const page = makeSimplePage('https://he.americanexpress.co.il/login/');
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, page);
    const msg1 = makeConsoleMessage('error', pmText);
    const msg2 = makeConsoleMessage('error', pmText);
    handler(msg1);
    handler(msg2);
    const frameEvents = logs.filter(l => l.event === 'login.frames');
    expect(frameEvents).toHaveLength(1);
  });

  it('does NOT include query strings in mainUrl (PII-safe)', () => {
    const pageWithQuery = makeSimplePage(
      'https://he.americanexpress.co.il/login/?session=99887766',
    );
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, pageWithQuery);
    const msg = makeConsoleMessage('error', pmText);
    handler(msg);
    const frameLog = logs.find(l => l.event === 'login.frames') as unknown as {
      mainUrl: string;
    };
    expect(frameLog.mainUrl).not.toContain('?');
    expect(frameLog.mainUrl).not.toContain('session');
  });
});

// ---------------------------------------------------------------------------
// D2 — scrub 300-char cap: both postMessage origins survive
// ---------------------------------------------------------------------------

describe('buildConsoleHandler D2 — scrub 300-char cap preserves both origins', () => {
  /** First origin that appears early in the postMessage error text. */
  const originA = 'https://web.americanexpress.co.il';
  /** Second origin that appears past the old 120-char cap. */
  const originB = 'https://he.americanexpress.co.il';
  /** Realistic ~167-char postMessage error text containing both origins. */
  const longPmText =
    "blocked postMessage because the target origin ('" +
    originA +
    "') does not match the recipient window's origin ('" +
    originB +
    "').";

  it('preserves BOTH origin strings within the 300-char cap', () => {
    const page = makeSimplePage();
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', longPmText);
    handler(msg);
    const rec = logs.find(l => l.event === 'login.console') as unknown as {
      textScrubbed: string;
    };
    expect(rec.textScrubbed).toContain(originA);
    expect(rec.textScrubbed).toContain(originB);
    expect(rec.textScrubbed.length).toBeLessThanOrEqual(300);
  });

  it('still scrubs digit-runs within the wider 300-char window', () => {
    const textWithDigit = longPmText.replace('postMessage', 'postMessage 12345678');
    const page = makeSimplePage();
    const { logger, logs } = makeLogger();
    const handler = buildConsoleHandler(logger, page);
    const msg = makeConsoleMessage('error', textWithDigit);
    handler(msg);
    const rec = logs.find(l => l.event === 'login.console') as unknown as {
      textScrubbed: string;
    };
    expect(rec.textScrubbed).not.toMatch(/\d{4}/);
    expect(rec.textScrubbed).toContain('#');
  });

  it('RED proof — old 120-char cap omitted the second origin (D2)', () => {
    // Proves the cap widening was necessary: at 120 chars, originB is absent.
    const at120 = longPmText.slice(0, 120);
    expect(at120).toContain(originA);
    expect(at120).not.toContain(originB);
  });
});
