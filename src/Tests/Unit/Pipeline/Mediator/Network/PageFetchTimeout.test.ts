/**
 * Unit tests for the in-page fetch abort budget.
 *
 * `page.evaluate` accepts no `timeout` option (playwright-core types: the only
 * option is `exposeFunctions`), and `setDefaultTimeout` documents itself as
 * covering "all the methods accepting `timeout` option". So Playwright does
 * NOT bound an evaluate, and before this budget a stalled bank endpoint hung
 * the in-page fetch indefinitely.
 *
 * These tests give the fake page an `evaluate` that INVOKES the callback, so
 * the real in-page body runs in Node and the abort wiring is exercised rather
 * than mocked away. The 30 s budget itself is never waited on: the timeout
 * factory is stubbed with a controller the test aborts on demand.
 */

import type { Page } from 'playwright-core';

import {
  fetchGetWithinPage,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js';
import { NETWORK_FETCH_TIMEOUT_MS } from '../../../../../Scrapers/Pipeline/Mediator/Network/FetchConfig.js';

const REAL_FETCH = globalThis.fetch;
const REAL_TIMEOUT_FACTORY = AbortSignal.timeout.bind(AbortSignal);

/** Budgets handed to AbortSignal.timeout during the current test. */
let requestedBudgets: number[] = [];
/** Init object captured from the in-page fetch call. */
let capturedInit: RequestInit | undefined;
/** Controller backing the stubbed timeout signal, so tests abort on demand. */
let controller: AbortController;

/**
 * A page whose evaluate runs the callback in-process. Playwright would
 * serialise the body into the browser; running it here executes the same code
 * against Node's fetch and AbortSignal.
 * @returns Fake page.
 */
function createInvokingPage(): Page {
  /**
   * Invoke the in-page body directly.
   * @param fn - The serialised in-page callback.
   * @param args - Its single argument bundle.
   * @returns Whatever the in-page body returns.
   */
  const evaluate = (fn: (a: unknown) => unknown, args: unknown): unknown => fn(args);
  return { evaluate } as unknown as Page;
}

/**
 * Replace the timeout factory so no test waits on the real 30 s budget.
 * @returns True once installed.
 */
function stubTimeoutFactory(): boolean {
  /**
   * Record the requested budget and hand back a controllable signal.
   * @param ms - Budget requested by production code.
   * @returns Signal the test can abort.
   */
  const factory = (ms: number): AbortSignal => {
    requestedBudgets.push(ms);
    return controller.signal;
  };
  AbortSignal.timeout = factory;
  return true;
}

/**
 * Stub fetch with a successful JSON response, capturing the init it received.
 * @param body - Response body text.
 * @returns True once installed.
 */
function stubRespondingFetch(body: string): boolean {
  /**
   * Capture init, then resolve a minimal Response.
   * @param _url - Ignored; assertions target the init.
   * @param init - Init built by the in-page body.
   * @returns Resolved mock response.
   */
  const stub = (_url: string, init: RequestInit): Promise<Response> => {
    capturedInit = init;
    /**
     * Response body text accessor.
     * @returns Resolved body string.
     */
    const text = (): Promise<string> => Promise.resolve(body);
    return Promise.resolve({ status: 200, text } as unknown as Response);
  };
  globalThis.fetch = stub as unknown as typeof fetch;
  return true;
}

/**
 * Stub fetch with a request that never resolves on its own and rejects only
 * when the abort signal fires — the browser's behaviour for an aborted fetch.
 * @returns True once installed.
 */
function stubStallingFetch(): boolean {
  /**
   * Hang until the caller-supplied signal aborts.
   * @param _url - Ignored.
   * @param init - Init built by the in-page body.
   * @returns Promise that rejects on abort.
   */
  const stub = (_url: string, init: RequestInit): Promise<Response> => {
    capturedInit = init;
    const signal = init.signal;
    expect(signal).toBeDefined();
    return new Promise<Response>((_resolve, reject) => {
      /**
       * Reject the pending fetch once the signal aborts.
       * @returns True once the rejection has been queued.
       */
      const onAbort = (): boolean => {
        const failure = new Error('TimeoutError: signal timed out');
        reject(failure);
        return true;
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  globalThis.fetch = stub as unknown as typeof fetch;
  return true;
}

beforeEach(() => {
  requestedBudgets = [];
  capturedInit = undefined;
  controller = new AbortController();
  stubTimeoutFactory();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  AbortSignal.timeout = REAL_TIMEOUT_FACTORY;
});

describe('in-page GET abort budget', () => {
  it('requests the same budget the native path uses', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await fetchGetWithinPage(page, 'https://bank.co.il/api');
    expect(requestedBudgets).toEqual([NETWORK_FETCH_TIMEOUT_MS]);
  });

  it('hands the abort signal to the in-page fetch', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await fetchGetWithinPage(page, 'https://bank.co.il/api');
    expect(capturedInit?.signal).toBe(controller.signal);
  });

  it('surfaces an aborted request instead of hanging', async () => {
    stubStallingFetch();
    const page = createInvokingPage();
    const pending = fetchGetWithinPage(page, 'https://bank.co.il/api');
    controller.abort();
    await expect(pending).rejects.toThrow('TimeoutError');
  });
});

describe('in-page POST abort budget', () => {
  it('requests the same budget the native path uses', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await fetchPostWithinPage(page, 'https://bank.co.il/api', { data: {} });
    expect(requestedBudgets).toEqual([NETWORK_FETCH_TIMEOUT_MS]);
  });

  it('hands the abort signal to the in-page fetch', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await fetchPostWithinPage(page, 'https://bank.co.il/api', { data: {} });
    expect(capturedInit?.signal).toBe(controller.signal);
  });

  it('keeps the captured SPA headers alongside the signal', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    const opts = { data: {}, extraHeaders: { 'X-Captured': 'val' } };
    await fetchPostWithinPage(page, 'https://bank.co.il/api', opts);
    expect(capturedInit?.headers).toMatchObject({ 'X-Captured': 'val' });
  });

  it('surfaces an aborted request instead of hanging', async () => {
    stubStallingFetch();
    const page = createInvokingPage();
    const pending = fetchPostWithinPage(page, 'https://bank.co.il/api', { data: {} });
    controller.abort();
    await expect(pending).rejects.toThrow('TimeoutError');
  });
});
