/**
 * Unit tests for PageObservers — L7 forensic observers attached to
 * the Camoufox page at INIT start so a failure snapshot can include
 * the frame tree, JS console errors, and the landing-document
 * response (PII-redacted) at the moment of failure.
 *
 * <p>Covers:
 *
 * <ul>
 *  <li>{@link captureFrameTree} — happy-path frame enumeration AND
 *      the accessor-throws fallback (never-throws contract).</li>
 *  <li>{@link attachConsoleErrorBuffer} — accumulation of
 *      error-level console messages + pageerror exceptions;
 *      filtering of non-error console messages; detach removes
 *      both listeners.</li>
 *  <li>{@link attachLandingResponseCollector} — captures ONLY the
 *      main frame's document response; redacts Set-Cookie down to
 *      cookie name; projects only allow-listed headers; keeps the
 *      last landing response when multiple are emitted; detach
 *      removes the listener.</li>
 * </ul>
 *
 * <p>Mocking strategy mirrors {@link "./NavigationDiagnostics.test.js"}:
 * tiny recording-page stubs storing handlers in typed arrays so
 * tests can dispatch events synchronously without spinning up
 * Camoufox. Each test pre-builds its event payload in a local
 * variable so dispatch sites are flat (no nested calls).
 */

import type { ConsoleMessage, Frame, Page, Request, Response } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { INIT_FORENSICS_ENV_VAR } from '../../../../../Scrapers/Pipeline/Mediator/Init/InitForensicsGate.js';
import {
  attachConsoleErrorBuffer,
  attachLandingResponseCollector,
  captureFrameTree,
  type IConsoleErrorEntry,
  type IResponseInfo,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/PageObservers.js';
import { isSome, type Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/* ─── Forensics gate test scaffolding ──────────────────────── */

/**
 * Snapshot of the gate env-var taken at module load so per-suite
 * setup can restore it after toggling. Mutable by design — the
 * value is read once before any test runs.
 */
let priorForensicsGate: string | undefined;

beforeAll(captureForensicsGate);
afterAll(restoreForensicsGate);

/**
 * Capture the initial value of the forensics gate env-var and
 * enable it for the test run — every observer in this file is
 * tested in its "real attach" mode, which only runs when the gate
 * is on (default-OFF guards the WAF-passing baseline).
 *
 * @returns Always `true`.
 */
function captureForensicsGate(): boolean {
  priorForensicsGate = process.env[INIT_FORENSICS_ENV_VAR];
  process.env[INIT_FORENSICS_ENV_VAR] = '1';
  return true;
}

/**
 * Restore the gate env-var to its pre-test value so other test
 * files run with the production default (gate OFF).
 *
 * @returns Always `true`.
 */
function restoreForensicsGate(): boolean {
  if (priorForensicsGate === undefined) Reflect.deleteProperty(process.env, INIT_FORENSICS_ENV_VAR);
  else process.env[INIT_FORENSICS_ENV_VAR] = priorForensicsGate;
  return true;
}

/* ─── Generic scripted-value helpers ───────────────────────── */

/**
 * Module-level scripted-string getter — kept module level so stubs
 * can `.bind(null, value)` without inline arrows that trip the
 * JSDoc-on-every-function rule.
 *
 * @param value - Pre-bound string to return.
 * @returns The bound string.
 */
function returnString(value: string): string {
  return value;
}

/**
 * Module-level scripted-boolean getter — see {@link returnString}.
 *
 * @param value - Pre-bound boolean to return.
 * @returns The bound boolean.
 */
function returnBoolean(value: boolean): boolean {
  return value;
}

/**
 * Module-level scripted-number getter — see {@link returnString}.
 *
 * @param value - Pre-bound number to return.
 * @returns The bound number.
 */
function returnNumber(value: number): number {
  return value;
}

/**
 * In-place remove of `target` from `list` (reference equality).
 * Mutates the array so detach in the test recorders affects the
 * caller-visible reference, not a re-assigned copy.
 *
 * @param list - Source array (mutated in place).
 * @param target - Item to drop.
 * @returns Always `true`.
 */
function spliceOut<T>(list: T[], target: T): boolean {
  const idx = list.indexOf(target);
  if (idx >= 0) list.splice(idx, 1);
  return true;
}

/* ─── Frame stub ───────────────────────────────────────────── */

/**
 * Build a Frame stub with the supplied accessor return values. The
 * stub is cast through `unknown` so Playwright's Frame interface is
 * accepted without re-implementing the full surface.
 *
 * @param name - Frame name.
 * @param url - Frame URL.
 * @param isDetached - Whether the frame reports as detached.
 * @returns Frame-shaped stub.
 */
function makeFrame(name: string, url: string, isDetached: boolean): Frame {
  const nameFn = returnString.bind(null, name);
  const urlFn = returnString.bind(null, url);
  const detachedFn = returnBoolean.bind(null, isDetached);
  return { name: nameFn, url: urlFn, isDetached: detachedFn } as unknown as Frame;
}

/* ─── captureFrameTree ─────────────────────────────────────── */

/**
 * Module-level scripted-frames getter so the FramesPage stub
 * avoids inline arrows.
 *
 * @param frames - Pre-bound frames list.
 * @returns The bound frames list.
 */
function returnFrames(frames: Frame[]): Frame[] {
  return frames;
}

/**
 * Module-level throwing-frames getter used by
 * {@link makeThrowingFramesPage}.
 *
 * @returns Never returns; always throws.
 */
function throwFrames(): Frame[] {
  throw new ScraperError('page closed');
}

/**
 * Build a page stub whose `frames()` returns the supplied list.
 *
 * @param frames - Frames to return.
 * @returns Page stub with synchronous `frames()` accessor.
 */
function makeFramesPage(frames: Frame[]): Page {
  const framesFn = returnFrames.bind(null, frames);
  return { frames: framesFn } as unknown as Page;
}

/**
 * Build a page stub whose `frames()` accessor throws — exercises
 * the never-throws fallback in {@link captureFrameTree}.
 *
 * @returns Page stub with throwing `frames()`.
 */
function makeThrowingFramesPage(): Page {
  return { frames: throwFrames } as unknown as Page;
}

describe('captureFrameTree', () => {
  it('snapshots every frame returned by page.frames()', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const child = makeFrame('challenge', 'https://bank/captcha', false);
    const page = makeFramesPage([main, child]);
    const tree = captureFrameTree(page);
    expect(tree).toEqual([
      { name: '', url: 'https://bank/login', isDetached: false },
      { name: 'challenge', url: 'https://bank/captcha', isDetached: false },
    ]);
  });

  it('returns empty array when page.frames() throws (never-throws contract)', () => {
    const page = makeThrowingFramesPage();
    const tree = captureFrameTree(page);
    expect(tree).toEqual([]);
  });
});

/* ─── attachConsoleErrorBuffer ─────────────────────────────── */

/** Handler shape Playwright's `console` listener delivers. */
type IConsoleHandler = (msg: ConsoleMessage) => boolean;
/** Handler shape Playwright's `pageerror` listener delivers. */
type IPageErrorHandler = (error: Error) => boolean;

/** Two-bucket recorder for the console-buffer observer. */
interface IConsoleRecordingPage {
  consoleHandlers: IConsoleHandler[];
  pageerrorHandlers: IPageErrorHandler[];
  readonly on: (event: string, handler: unknown) => boolean;
  readonly off: (event: string, handler: unknown) => boolean;
}

/**
 * Register a handler under the matching event bucket on the
 * console-recording page.
 *
 * @param page - Console-recording page stub.
 * @param event - Event name.
 * @param handler - Handler to record.
 * @returns Always `true`.
 */
function consoleRecordOn(page: IConsoleRecordingPage, event: string, handler: unknown): boolean {
  if (event === 'console') page.consoleHandlers.push(handler as IConsoleHandler);
  if (event === 'pageerror') page.pageerrorHandlers.push(handler as IPageErrorHandler);
  return true;
}

/**
 * Remove a previously-registered handler from the matching event
 * bucket on the console-recording page.
 *
 * @param page - Console-recording page stub.
 * @param event - Event name.
 * @param handler - Handler to remove.
 * @returns Always `true`.
 */
function consoleRecordOff(page: IConsoleRecordingPage, event: string, handler: unknown): boolean {
  if (event === 'console') spliceOut(page.consoleHandlers, handler as IConsoleHandler);
  if (event === 'pageerror') spliceOut(page.pageerrorHandlers, handler as IPageErrorHandler);
  return true;
}

/**
 * Build a console-recording page stub.
 *
 * @returns Stub with two typed handler arrays + on/off recorders.
 */
function makeConsoleRecordingPage(): IConsoleRecordingPage {
  const consoleHandlers: IConsoleHandler[] = [];
  const pageerrorHandlers: IPageErrorHandler[] = [];
  const partial = { consoleHandlers, pageerrorHandlers };
  const on = bindConsoleOn(partial as IConsoleRecordingPage);
  const off = bindConsoleOff(partial as IConsoleRecordingPage);
  return { consoleHandlers, pageerrorHandlers, on, off };
}

/**
 * Bind {@link consoleRecordOn} to the given recording-page stub.
 *
 * @param page - Console-recording page stub.
 * @returns Bound on-handler.
 */
function bindConsoleOn(page: IConsoleRecordingPage): (event: string, handler: unknown) => boolean {
  return consoleRecordOn.bind(null, page);
}

/**
 * Bind {@link consoleRecordOff} to the given recording-page stub.
 *
 * @param page - Console-recording page stub.
 * @returns Bound off-handler.
 */
function bindConsoleOff(page: IConsoleRecordingPage): (event: string, handler: unknown) => boolean {
  return consoleRecordOff.bind(null, page);
}

/** Shape Playwright exposes via `ConsoleMessage.location()`. */
interface IConsoleLocation {
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Module-level scripted-location getter so the ConsoleMessage stub
 * avoids inline arrows.
 *
 * @param loc - Pre-bound location object.
 * @returns The bound location.
 */
function returnLocation(loc: IConsoleLocation): IConsoleLocation {
  return loc;
}

/**
 * Module-level throwing location getter — exercises the
 * `formatConsoleLocation` fallback in PageObservers.
 *
 * @returns Never returns; always throws.
 */
function throwLocation(): IConsoleLocation {
  throw new ScraperError('detached');
}

/**
 * Build a ConsoleMessage stub with the supplied accessor returns.
 *
 * @param type - `type()` return value (e.g. `error` / `info`).
 * @param text - `text()` return value.
 * @param location - `location()` return value.
 * @returns ConsoleMessage stub.
 */
function makeConsoleMessage(
  type: string,
  text: string,
  location: IConsoleLocation,
): ConsoleMessage {
  const typeFn = returnString.bind(null, type);
  const textFn = returnString.bind(null, text);
  const locFn = returnLocation.bind(null, location);
  return { type: typeFn, text: textFn, location: locFn } as unknown as ConsoleMessage;
}

/**
 * Build a ConsoleMessage stub whose `location()` accessor throws.
 *
 * @param type - `type()` return value.
 * @param text - `text()` return value.
 * @returns ConsoleMessage stub with throwing `location`.
 */
function makeThrowingLocationMessage(type: string, text: string): ConsoleMessage {
  const typeFn = returnString.bind(null, type);
  const textFn = returnString.bind(null, text);
  return { type: typeFn, text: textFn, location: throwLocation } as unknown as ConsoleMessage;
}

describe('attachConsoleErrorBuffer', () => {
  it('accumulates error-level console messages with formatted location', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    const location: IConsoleLocation = { url: 'https://b/x.js', lineNumber: 42, columnNumber: 7 };
    const msg = makeConsoleMessage('error', 'boom', location);
    const handler = page.consoleHandlers[0];
    handler(msg);
    const expected: IConsoleErrorEntry[] = [
      { source: 'console', text: 'boom', location: 'https://b/x.js:42:7' },
    ];
    expect(buffer.collected).toEqual(expected);
  });

  it('filters out non-error console messages (info/warn/debug)', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    const zeroLoc: IConsoleLocation = { url: '', lineNumber: 0, columnNumber: 0 };
    const info = makeConsoleMessage('info', 'hi', zeroLoc);
    const warn = makeConsoleMessage('warning', 'careful', zeroLoc);
    const handler = page.consoleHandlers[0];
    handler(info);
    handler(warn);
    expect(buffer.collected).toEqual([]);
  });

  it('captures pageerror uncaught exceptions with normalised message', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    const handler = page.pageerrorHandlers[0];
    const err = new Error('script crashed');
    handler(err);
    const expected: IConsoleErrorEntry[] = [
      { source: 'pageerror', text: 'script crashed', location: '' },
    ];
    expect(buffer.collected).toEqual(expected);
  });

  it('falls back to empty location when ConsoleMessage.location() throws', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    const broken = makeThrowingLocationMessage('error', 'unknown loc');
    const handler = page.consoleHandlers[0];
    handler(broken);
    const expected: IConsoleErrorEntry[] = [
      { source: 'console', text: 'unknown loc', location: '' },
    ];
    expect(buffer.collected).toEqual(expected);
  });

  it('detach removes BOTH console and pageerror listeners', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    expect(page.consoleHandlers).toHaveLength(1);
    expect(page.pageerrorHandlers).toHaveLength(1);
    buffer.detach();
    expect(page.consoleHandlers).toHaveLength(0);
    expect(page.pageerrorHandlers).toHaveLength(0);
  });
});

/* ─── attachLandingResponseCollector ───────────────────────── */

/** Handler shape Playwright's `response` listener delivers. */
type IResponseHandler = (response: Response) => boolean;

/** Single-bucket recorder for the landing-response observer. */
interface IResponseRecordingPage {
  responseHandlers: IResponseHandler[];
  readonly mainFrame: () => Frame;
  readonly on: (event: string, handler: unknown) => boolean;
  readonly off: (event: string, handler: unknown) => boolean;
}

/**
 * Module-level scripted-frame getter so the response-page stub
 * avoids inline arrows.
 *
 * @param frame - Pre-bound frame.
 * @returns The bound frame.
 */
function returnFrame(frame: Frame): Frame {
  return frame;
}

/**
 * Register a handler on the response-recording page stub.
 *
 * @param page - Response-recording page stub.
 * @param event - Event name.
 * @param handler - Handler to record.
 * @returns Always `true`.
 */
function responseRecordOn(page: IResponseRecordingPage, event: string, handler: unknown): boolean {
  if (event === 'response') page.responseHandlers.push(handler as IResponseHandler);
  return true;
}

/**
 * Remove a previously-registered handler from the response-
 * recording page stub.
 *
 * @param page - Response-recording page stub.
 * @param event - Event name.
 * @param handler - Handler to remove.
 * @returns Always `true`.
 */
function responseRecordOff(page: IResponseRecordingPage, event: string, handler: unknown): boolean {
  if (event === 'response') spliceOut(page.responseHandlers, handler as IResponseHandler);
  return true;
}

/**
 * Bind {@link responseRecordOn} to the given response-recording stub.
 *
 * @param page - Response-recording page stub.
 * @returns Bound on-handler.
 */
function bindResponseOn(
  page: IResponseRecordingPage,
): (event: string, handler: unknown) => boolean {
  return responseRecordOn.bind(null, page);
}

/**
 * Bind {@link responseRecordOff} to the given response-recording stub.
 *
 * @param page - Response-recording page stub.
 * @returns Bound off-handler.
 */
function bindResponseOff(
  page: IResponseRecordingPage,
): (event: string, handler: unknown) => boolean {
  return responseRecordOff.bind(null, page);
}

/**
 * Build a response-recording page stub with the given main frame.
 *
 * @param mainFrame - Frame returned by `page.mainFrame()`.
 * @returns Response-recording stub.
 */
function makeResponseRecordingPage(mainFrame: Frame): IResponseRecordingPage {
  const responseHandlers: IResponseHandler[] = [];
  const mainFn = returnFrame.bind(null, mainFrame);
  const partial = { responseHandlers, mainFrame: mainFn };
  const on = bindResponseOn(partial as IResponseRecordingPage);
  const off = bindResponseOff(partial as IResponseRecordingPage);
  return { responseHandlers, mainFrame: mainFn, on, off };
}

/** Bundled inputs for {@link makeResponse} (`max-params: 3` rule). */
interface IResponseStubInput {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly resourceType: string;
  readonly frame: Frame;
}

/**
 * Module-level scripted-headers getter so the Response stub
 * avoids inline arrows.
 *
 * @param headers - Pre-bound headers map.
 * @returns The bound headers map.
 */
function returnHeaders(headers: Record<string, string>): Record<string, string> {
  return headers;
}

/**
 * Build a Request stub used as `response.request()` — exposes
 * `resourceType()` + `frame()` accessors.
 *
 * @param resourceType - `resourceType()` return value.
 * @param frame - `frame()` return value.
 * @returns Request stub.
 */
function makeRequest(resourceType: string, frame: Frame): Request {
  const rtFn = returnString.bind(null, resourceType);
  const frameFn = returnFrame.bind(null, frame);
  return { resourceType: rtFn, frame: frameFn } as unknown as Request;
}

/**
 * Module-level scripted-request getter so the Response stub
 * avoids inline arrows.
 *
 * @param request - Pre-bound request.
 * @returns The bound request.
 */
function returnRequest(request: Request): Request {
  return request;
}

/**
 * Build a Response stub backed by a Request stub. All accessors
 * are synchronous; no awaits needed in tests.
 *
 * @param input - Bundled stub inputs.
 * @returns Response stub.
 */
function makeResponse(input: IResponseStubInput): Response {
  const request = makeRequest(input.resourceType, input.frame);
  const accessors = buildResponseAccessors(input);
  const requestFn = returnRequest.bind(null, request);
  return { ...accessors, request: requestFn } as unknown as Response;
}

/** Bundle of the scalar accessor functions of a Response stub. */
interface IResponseAccessors {
  readonly url: () => string;
  readonly status: () => number;
  readonly statusText: () => string;
  readonly headers: () => Record<string, string>;
}

/**
 * Build the scalar accessor functions of a Response stub. Split
 * out so {@link makeResponse} stays small and the project's
 * `max-lines-per-function` budget for the test file is respected.
 *
 * @param input - Bundled stub inputs.
 * @returns Bundle of bound accessor functions.
 */
function buildResponseAccessors(input: IResponseStubInput): IResponseAccessors {
  const url = returnString.bind(null, input.url);
  const status = returnNumber.bind(null, input.status);
  const statusText = returnString.bind(null, input.statusText);
  const headers = returnHeaders.bind(null, input.headers);
  return { url, status, statusText, headers };
}

describe('attachLandingResponseCollector', () => {
  it('captures main-frame document response, projects allow-listed headers, redacts Set-Cookie', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    const response = makeResponse({
      url: 'https://bank/login',
      status: 200,
      statusText: 'OK',
      headers: {
        'set-cookie': 'session=abc123; Path=/; HttpOnly',
        'content-type': 'text/html',
        'x-frame-options': 'DENY',
        authorization: 'should-not-appear',
      },
      resourceType: 'document',
      frame: main,
    });
    const handler = page.responseHandlers[0];
    handler(response);
    const captured = collector.getResponse();
    const expectedHeaders: Record<string, string> = {
      'set-cookie': 'session=<redacted>',
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
    };
    assertResponseEquals(captured, {
      url: 'https://bank/login',
      status: 200,
      statusText: 'OK',
      headers: expectedHeaders,
    });
  });

  it('ignores sub-resource responses (resourceType !== document)', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    const subResource = makeResponse({
      url: 'https://bank/logo.png',
      status: 200,
      statusText: 'OK',
      headers: {},
      resourceType: 'image',
      frame: main,
    });
    const handler = page.responseHandlers[0];
    handler(subResource);
    const captured = collector.getResponse();
    const isPresent = isSome(captured);
    expect(isPresent).toBe(false);
  });

  it('ignores iframe document responses (frame !== mainFrame)', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const child = makeFrame('captcha', 'https://challenge/x', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    const iframeDoc = makeResponse({
      url: 'https://challenge/x',
      status: 200,
      statusText: 'OK',
      headers: {},
      resourceType: 'document',
      frame: child,
    });
    const handler = page.responseHandlers[0];
    handler(iframeDoc);
    const captured = collector.getResponse();
    const isPresent = isSome(captured);
    expect(isPresent).toBe(false);
  });

  it('keeps the LAST landing response when multiple are emitted', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    const first = makeResponse({
      url: 'https://bank/redirect',
      status: 302,
      statusText: 'Found',
      headers: {},
      resourceType: 'document',
      frame: main,
    });
    const second = makeResponse({
      url: 'https://bank/login',
      status: 200,
      statusText: 'OK',
      headers: {},
      resourceType: 'document',
      frame: main,
    });
    const handler = page.responseHandlers[0];
    handler(first);
    handler(second);
    const captured = collector.getResponse();
    assertResponseUrlEquals(captured, 'https://bank/login');
  });

  it('detach removes the response listener', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    expect(page.responseHandlers).toHaveLength(1);
    collector.detach();
    expect(page.responseHandlers).toHaveLength(0);
  });

  it('redacts Set-Cookie with empty cookie name to a bare <redacted>', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    const response = makeResponse({
      url: 'https://bank/login',
      status: 200,
      statusText: 'OK',
      headers: { 'set-cookie': '=value; Path=/' },
      resourceType: 'document',
      frame: main,
    });
    const handler = page.responseHandlers[0];
    handler(response);
    const captured = collector.getResponse();
    assertSetCookieEquals(captured, '<redacted>');
  });
});

/* ─── Assertion helpers ────────────────────────────────────── */

/**
 * Assert that the Option-wrapped projection is `some(payload)` and
 * deeply equals `expected`. Returns `true` so the test body has a
 * non-void expression (no-void rule).
 *
 * @param captured - Option-wrapped projection from the collector.
 * @param expected - Expected payload.
 * @returns Always `true`.
 */
function assertResponseEquals(captured: Option<IResponseInfo>, expected: IResponseInfo): boolean {
  const isPresent = isSome(captured);
  expect(isPresent).toBe(true);
  if (!isSome(captured)) return true;
  expect(captured.value).toEqual(expected);
  return true;
}

/**
 * Assert that the Option-wrapped projection is `some` and its `url`
 * field matches the expected value.
 *
 * @param captured - Option-wrapped projection from the collector.
 * @param expectedUrl - Expected URL.
 * @returns Always `true`.
 */
function assertResponseUrlEquals(captured: Option<IResponseInfo>, expectedUrl: string): boolean {
  const isPresent = isSome(captured);
  expect(isPresent).toBe(true);
  if (!isSome(captured)) return true;
  expect(captured.value.url).toBe(expectedUrl);
  return true;
}

/**
 * Assert that the captured response's `set-cookie` header matches
 * the expected redacted form.
 *
 * @param captured - Option-wrapped projection from the collector.
 * @param expected - Expected redacted Set-Cookie value.
 * @returns Always `true`.
 */
function assertSetCookieEquals(captured: Option<IResponseInfo>, expected: string): boolean {
  const isPresent = isSome(captured);
  expect(isPresent).toBe(true);
  if (!isSome(captured)) return true;
  const setCookie = captured.value.headers['set-cookie'];
  expect(setCookie).toBe(expected);
  return true;
}

/* ─── Forensics gate OFF — no-op contract ──────────────────── */

/**
 * Disable the forensics gate for one assertion, restore afterwards.
 * Bound around each test in the gate-OFF describe block so the
 * default-OFF behavior is exercised in isolation.
 *
 * @returns Always `true`.
 */
function disableForensicsGateForTest(): boolean {
  Reflect.deleteProperty(process.env, INIT_FORENSICS_ENV_VAR);
  return true;
}

/**
 * Re-enable the forensics gate after a gate-OFF test so the rest
 * of the suite keeps its "real attach" assumptions intact.
 *
 * @returns Always `true`.
 */
function reenableForensicsGateForTest(): boolean {
  process.env[INIT_FORENSICS_ENV_VAR] = '1';
  return true;
}

describe('PageObservers — forensics gate OFF (default WAF-safe)', () => {
  beforeEach(disableForensicsGateForTest);
  afterEach(reenableForensicsGateForTest);

  it('captureFrameTree returns empty list without touching page.frames()', () => {
    const page = makeThrowingFramesPage();
    const tree = captureFrameTree(page);
    expect(tree).toEqual([]);
  });

  it('attachConsoleErrorBuffer returns no-op buffer and registers no listeners', () => {
    const page = makeConsoleRecordingPage();
    const buffer = attachConsoleErrorBuffer(page as unknown as Page);
    expect(page.consoleHandlers).toHaveLength(0);
    expect(page.pageerrorHandlers).toHaveLength(0);
    expect(buffer.collected).toEqual([]);
    buffer.detach();
    expect(page.consoleHandlers).toHaveLength(0);
  });

  it('attachLandingResponseCollector returns no-op collector and registers no listener', () => {
    const main = makeFrame('', 'https://bank/login', false);
    const page = makeResponseRecordingPage(main);
    const collector = attachLandingResponseCollector(page as unknown as Page);
    expect(page.responseHandlers).toHaveLength(0);
    const captured = collector.getResponse();
    const isPresent = isSome(captured);
    expect(isPresent).toBe(false);
    collector.detach();
    expect(page.responseHandlers).toHaveLength(0);
  });
});
