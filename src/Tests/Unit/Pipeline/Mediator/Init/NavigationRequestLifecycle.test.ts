/**
 * Unit tests for {@link attachRequestLifecycleObserver} — the helper
 * that records every request the page started but never finished.
 *
 * <p>Coverage targets:
 * - Subscribes to the four lifecycle events (`request`, `response`,
 *   `requestfinished`, `requestfailed`).
 * - `request` adds an entry; `response` mutates it to
 *   `response-received`; `requestfinished` and `requestfailed` remove
 *   it from the tracking map.
 * - Snapshot is oldest-first.
 * - Snapshot caps at 25 entries with the truncation flag + true count.
 * - `detach()` removes every listener.
 *
 * <p>Mocking strategy: a recording {@link IRecordingPage} that mirrors
 * Playwright's `on` / `off` surface. Request stubs return scripted
 * `url() / method() / resourceType()`. No `jest.mock` — pure DI.
 */

import type { Page, Request, Response } from 'playwright-core';

import {
  attachRequestLifecycleObserver,
  type INavInFlightRequest,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/NavigationRequestLifecycle.js';

/** Handler signature shared by every Playwright lifecycle event in this test. */
type IAnyHandler = (arg: Request | Response) => boolean;

/** Stub Page that records on/off registrations per event name. */
interface IRecordingPage {
  readonly handlers: Map<string, IAnyHandler[]>;
  readonly on: (event: string, handler: IAnyHandler) => boolean;
  readonly off: (event: string, handler: IAnyHandler) => boolean;
}

/**
 * Register a handler for the given event name on the recording page.
 *
 * @param handlers - Shared map of event-to-handlers.
 * @param event - Event name (request / response / requestfinished / requestfailed).
 * @param handler - Handler being registered.
 * @returns Always `true` (no-void rule).
 */
function recordOn(
  handlers: Map<string, IAnyHandler[]>,
  event: string,
  handler: IAnyHandler,
): boolean {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
  return true;
}

/**
 * Remove a previously-registered handler for the given event name.
 *
 * @param handlers - Shared map of event-to-handlers.
 * @param event - Event name to look up.
 * @param handler - Handler instance to remove.
 * @returns Always `true` (no-void rule).
 */
function recordOff(
  handlers: Map<string, IAnyHandler[]>,
  event: string,
  handler: IAnyHandler,
): boolean {
  const list = handlers.get(event);
  if (!list) return true;
  const idx = list.indexOf(handler);
  if (idx >= 0) list.splice(idx, 1);
  return true;
}

/**
 * Build a recording Page surface that satisfies the on/off contract
 * used by {@link attachRequestLifecycleObserver}.
 *
 * @returns Recording page used in tests.
 */
function makeRecordingPage(): IRecordingPage {
  const handlers = new Map<string, IAnyHandler[]>();
  /**
   * Page `on` shim — delegates to {@link recordOn}.
   *
   * @param event - Event name to register against.
   * @param handler - Handler being registered.
   * @returns Always `true` (no-void rule).
   */
  const on = (event: string, handler: IAnyHandler): boolean => recordOn(handlers, event, handler);
  /**
   * Page `off` shim — delegates to {@link recordOff}.
   *
   * @param event - Event name to deregister from.
   * @param handler - Handler being deregistered.
   * @returns Always `true` (no-void rule).
   */
  const off = (event: string, handler: IAnyHandler): boolean => recordOff(handlers, event, handler);
  return { handlers, on, off };
}

/** Bundle of inputs to {@link makeRequest} (`max-params: 3`). */
interface IMakeRequestInput {
  readonly url: string;
  readonly method?: string;
  readonly resourceType?: string;
}

/**
 * Build a stub Request with scripted accessors.
 *
 * @param input - Bundle carrying url and optional method / resourceType.
 * @returns Request stub cast through `unknown`.
 */
function makeRequest(input: IMakeRequestInput): Request {
  const method = input.method ?? 'GET';
  const resourceType = input.resourceType ?? 'document';
  /**
   * Scripted URL accessor.
   *
   * @returns Scripted URL string.
   */
  const urlFn = (): string => input.url;
  /**
   * Scripted HTTP method accessor.
   *
   * @returns Scripted HTTP method.
   */
  const methodFn = (): string => method;
  /**
   * Scripted resourceType accessor.
   *
   * @returns Scripted resource type.
   */
  const resourceTypeFn = (): string => resourceType;
  return { url: urlFn, method: methodFn, resourceType: resourceTypeFn } as unknown as Request;
}

/**
 * Build a stub Response whose `request()` returns the supplied stub.
 *
 * @param req - Request stub the response should report.
 * @returns Response stub cast through `unknown`.
 */
function makeResponse(req: Request): Response {
  /**
   * Scripted request accessor.
   *
   * @returns The request stub the response is for.
   */
  const requestFn = (): Request => req;
  return { request: requestFn } as unknown as Response;
}

/**
 * Fire the handler registered for the given event name on the
 * recording page. Bypasses the rule that arrow lambdas inside tests
 * still need JSDoc by extracting the dispatch helper here.
 *
 * @param page - Recording page whose handlers should be fired.
 * @param event - Event name to dispatch.
 * @param arg - Argument to pass to the handler (Request or Response).
 * @returns Always `true` (no-void rule).
 */
function fire(page: IRecordingPage, event: string, arg: Request | Response): boolean {
  const list = page.handlers.get(event) ?? [];
  for (const handler of list) handler(arg);
  return true;
}

describe('attachRequestLifecycleObserver — subscription', () => {
  it('subscribes to request / response / requestfinished / requestfailed', () => {
    const page = makeRecordingPage();
    attachRequestLifecycleObserver(page as unknown as Page);
    const requestHandlers = page.handlers.get('request');
    const responseHandlers = page.handlers.get('response');
    const finishedHandlers = page.handlers.get('requestfinished');
    const failedHandlers = page.handlers.get('requestfailed');
    expect(requestHandlers).toHaveLength(1);
    expect(responseHandlers).toHaveLength(1);
    expect(finishedHandlers).toHaveLength(1);
    expect(failedHandlers).toHaveLength(1);
  });

  it('detach removes every recorded handler', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    observer.detach();
    const requestHandlers = page.handlers.get('request');
    const responseHandlers = page.handlers.get('response');
    const finishedHandlers = page.handlers.get('requestfinished');
    const failedHandlers = page.handlers.get('requestfailed');
    expect(requestHandlers).toHaveLength(0);
    expect(responseHandlers).toHaveLength(0);
    expect(finishedHandlers).toHaveLength(0);
    expect(failedHandlers).toHaveLength(0);
  });
});

describe('attachRequestLifecycleObserver — state transitions', () => {
  it('records a started request with state="started"', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a' });
    fire(page, 'request', req);
    const snap = observer.snapshot();
    expect(snap.inFlightRequestCount).toBe(1);
    expect(snap.inFlightRequests[0]?.state).toBe<INavInFlightRequest['state']>('started');
    expect(snap.inFlightRequests[0]?.url).toBe('https://x/a');
  });

  it('response transitions an existing entry to "response-received"', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a' });
    fire(page, 'request', req);
    const response = makeResponse(req);
    fire(page, 'response', response);
    const snap = observer.snapshot();
    expect(snap.inFlightRequests[0]?.state).toBe<INavInFlightRequest['state']>('response-received');
  });

  it('response is a safe no-op when no entry exists for the request', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a' });
    const response = makeResponse(req);
    fire(page, 'response', response);
    const snap = observer.snapshot();
    expect(snap.inFlightRequestCount).toBe(0);
  });

  it('requestfinished removes the entry', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a' });
    fire(page, 'request', req);
    fire(page, 'requestfinished', req);
    const snap = observer.snapshot();
    expect(snap.inFlightRequestCount).toBe(0);
  });

  it('requestfailed removes the entry', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a' });
    fire(page, 'request', req);
    fire(page, 'requestfailed', req);
    const snap = observer.snapshot();
    expect(snap.inFlightRequestCount).toBe(0);
  });

  it('captures method + resourceType + startedMsAgo', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const req = makeRequest({ url: 'https://x/a', method: 'POST', resourceType: 'xhr' });
    fire(page, 'request', req);
    const snap = observer.snapshot();
    expect(snap.inFlightRequests[0]?.method).toBe('POST');
    expect(snap.inFlightRequests[0]?.resourceType).toBe('xhr');
    expect(snap.inFlightRequests[0]?.startedMsAgo).toBeGreaterThanOrEqual(0);
  });
});

describe('attachRequestLifecycleObserver — snapshot ordering and cap', () => {
  it('orders entries oldest-first', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const a = makeRequest({ url: 'https://x/a' });
    const b = makeRequest({ url: 'https://x/b' });
    const c = makeRequest({ url: 'https://x/c' });
    fire(page, 'request', a);
    fire(page, 'request', b);
    fire(page, 'request', c);
    const snap = observer.snapshot();
    const urls = snap.inFlightRequests.map(entry => entry.url);
    expect(urls).toEqual(['https://x/a', 'https://x/b', 'https://x/c']);
  });

  it('caps at 25 entries and sets isTruncated flag with true count', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    for (let i = 0; i < 30; i += 1) {
      const url = `https://x/${String(i)}`;
      const req = makeRequest({ url });
      fire(page, 'request', req);
    }
    const snap = observer.snapshot();
    expect(snap.inFlightRequests).toHaveLength(25);
    expect(snap.inFlightRequestCount).toBe(30);
    expect(snap.inFlightRequestsTruncated).toBe(true);
  });

  it('returns empty snapshot before any requests', () => {
    const page = makeRecordingPage();
    const observer = attachRequestLifecycleObserver(page as unknown as Page);
    const snap = observer.snapshot();
    expect(snap.inFlightRequests).toEqual([]);
    expect(snap.inFlightRequestCount).toBe(0);
    expect(snap.inFlightRequestsTruncated).toBe(false);
  });
});
