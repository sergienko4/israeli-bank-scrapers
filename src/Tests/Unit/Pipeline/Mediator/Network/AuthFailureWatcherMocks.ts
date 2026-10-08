/**
 * Shared AuthFailureWatcher test mocks: a MockPlaywrightPage that captures
 * `page.on('response')` listeners and `waitForResponse` waiters, a
 * synthetic Response factory, and a microtask `settle()` helper.
 */

import type { Page, Response } from 'playwright-core';

/** Synthetic Response shape used by the tests. */
export interface IMockResponse {
  /**
   * Response URL.
   * @returns The URL string.
   */
  url(): string;
  /**
   * Response HTTP status.
   * @returns The status code.
   */
  status(): number;
  /**
   * Response body.
   * @returns Promise resolving to the body text.
   */
  text(): Promise<string>;
}

/** Listener signature accepted by `page.on('response', listener)`. */
type ResponseListener = (response: Response) => unknown;

/** Resolver alias — Promise resolve callback for a Response. */
type ResponseResolver = (value: Response) => unknown;
/** Rejecter alias — Promise reject callback. */
type ErrorRejecter = (reason: Error) => unknown;

/** Pending awaitable wait registered by `waitForResponse`. */
interface IPendingWait {
  readonly matcher: (response: Response) => boolean;
  readonly resolve: ResponseResolver;
}

/** Test-only mock Page exposing helpers to drive the listener. */
export interface IMockPlaywrightPage {
  readonly handle: Page;
  readonly fire: (response: IMockResponse) => boolean;
  readonly listenerCount: () => number;
}

/**
 * Settle the JS microtask queue. After fire(), the watcher's listener
 * launches a fire-and-forget promise; setImmediate yields to it so
 * subsequent assertions see the updated state.
 * @returns Resolved promise after queue drain.
 */
export async function settle(): Promise<true> {
  /**
   * Flush microtasks via setImmediate.
   * @param resolve - Resolver for the outer Promise.
   * @returns True after immediate fires.
   */
  const flush = (resolve: (v: true) => unknown): unknown => {
    /**
     * Wrapper that calls resolve(true) — extracted so the inner
     * setImmediate callback returns a value (no void return).
     * @returns True.
     */
    const fire = (): boolean => {
      resolve(true);
      return true;
    };
    return globalThis.setImmediate(fire);
  };
  return new Promise<true>(flush);
}

/**
 * Build a synthetic Response with the supplied URL/status/body.
 * @param url - Response URL.
 * @param status - HTTP status code.
 * @param body - Body text returned by `.text()`.
 * @returns Mock Response shape.
 */
export function makeResponse(url: string, status: number, body: string): IMockResponse {
  /**
   * URL accessor.
   * @returns The URL.
   */
  const urlFn = (): string => url;
  /**
   * Status accessor.
   * @returns The status code.
   */
  const statusFn = (): number => status;
  /**
   * Body accessor.
   * @returns Promise of the body.
   */
  const textFn = (): Promise<string> => Promise.resolve(body);
  return { url: urlFn, status: statusFn, text: textFn };
}

/**
 * Build a MockPlaywrightPage. Tracks registered listeners and pending
 * waitForResponse calls so tests can drive both detection paths.
 * @returns MockPlaywrightPage with handle + helpers.
 */
export function makeMockPage(): IMockPlaywrightPage {
  const listeners: ResponseListener[] = [];
  const waits: IPendingWait[] = [];
  /**
   * Register an event listener.
   * @param event - Event name (only 'response' is honoured).
   * @param listener - Callback.
   * @returns Stub for chaining (Playwright contract).
   */
  const onFn = (event: string, listener: ResponseListener): unknown => {
    if (event === 'response') listeners.push(listener);
    return pageStub;
  };
  /**
   * Remove an event listener.
   * @param event - Event name.
   * @param listener - Listener to remove.
   * @returns Stub for chaining.
   */
  const offFn = (event: string, listener: ResponseListener): unknown => {
    if (event !== 'response') return pageStub;
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
    return pageStub;
  };
  /**
   * Match-or-timeout waiter mirroring Playwright's waitForResponse.
   * @param matcher - Predicate.
   * @param opts - Options including timeout.
   * @param opts.timeout - Max wait time.
   * @returns Promise resolving with the matched response, or rejecting on timeout.
   */
  const waitForResponseFn = (
    matcher: (response: Response) => boolean,
    opts: { timeout: number },
  ): Promise<Response> => {
    /**
     * Promise executor — registers waiter + arms a timeout.
     * @param resolve - Resolver.
     * @param reject - Rejecter.
     * @returns Cleanup is implicit via array splice.
     */
    const executor = (resolve: ResponseResolver, reject: ErrorRejecter): unknown => {
      /**
       * Timeout fires when no matching response arrived in time.
       * @returns True after rejecting the wait.
       */
      const onTimeout = (): boolean => {
        const idx = waits.findIndex((w): boolean => w.resolve === resolve);
        if (idx >= 0) waits.splice(idx, 1);
        const timeoutErr = new Error(`waitForResponse timeout ${String(opts.timeout)}ms`);
        reject(timeoutErr);
        return true;
      };
      const handle = globalThis.setTimeout(onTimeout, opts.timeout);
      if (typeof handle.unref === 'function') handle.unref();
      waits.push({ matcher, resolve });
      return handle;
    };
    return new Promise<Response>(executor);
  };
  const pageStub = { on: onFn, off: offFn, waitForResponse: waitForResponseFn };
  /**
   * Drive every registered listener AND resolve any waitForResponse
   * waiter whose matcher accepts this response. Mirrors Playwright's
   * actual behaviour: a single network response fans out to both
   * `page.on('response')` listeners and matching `waitForResponse`
   * promises in the same tick.
   * @param response - Response to broadcast.
   * @returns True after fan-out.
   */
  const fireFn = (response: IMockResponse): boolean => {
    const r = response as unknown as Response;
    const listenerSnapshot = listeners.slice();
    for (const fn of listenerSnapshot) fn(r);
    // Resolve any matching pending wait. Iterate over a copy because
    // resolve() may mutate the live array via the timeout cleanup.
    const waitSnapshot = waits.slice();
    for (const w of waitSnapshot) {
      if (!w.matcher(r)) continue;
      const idx = waits.indexOf(w);
      if (idx >= 0) waits.splice(idx, 1);
      w.resolve(r);
    }
    return true;
  };
  /**
   * Listener count probe.
   * @returns Current registered listener count.
   */
  const countFn = (): number => listeners.length;
  return { handle: pageStub as unknown as Page, fire: fireFn, listenerCount: countFn };
}
