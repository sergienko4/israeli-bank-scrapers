/**
 * `awaitTraffic` — header-vs-body read-race contract.
 *
 * <p>`page.waitForResponse` resolves on response HEADERS, but the
 * capture listener only appends a body-bearing endpoint after
 * `response.text()` resolves (~2-3 ms later). The SUCCESS path must
 * re-poll the live pool so that late body-bearing hit is seen (this is
 * the login-retry root-cause fix: a 2-3 ms false-fail forced a credential
 * re-submit). The TIMEOUT path must NOT add any settle wait so a bank
 * whose accounts API never arrives (Amex) still fails fast and honestly.
 *   Non-timeout terminal failures (page/context closure) must propagate
 *   rather than be swallowed as a silent no-match.
 */

import type { Page, Response } from 'playwright-core';
import { errors } from 'playwright-core';

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { awaitTraffic } from '../../../../../Scrapers/Pipeline/Mediator/Network/Polling/NetworkPolling.js';

const GET_CARD_LIST = /GetCardList/i;
const ACCOUNTS_URL = 'https://web.isracard.co.il/services/GetCardList';

/**
 * Build a synthetic body-bearing discovered endpoint.
 * @param url - Endpoint URL (matched against the WK patterns).
 * @returns Synthetic IDiscoveredEndpoint with a non-null body.
 */
function makeCapture(url: string): IDiscoveredEndpoint {
  return {
    url,
    method: 'POST',
    postData: '',
    responseBody: { cards: [] },
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
  };
}

/**
 * Fake page whose `waitForResponse` resolves on headers, then appends
 * `bodyHit` to the live pool ~5 ms later — mirrors the capture listener
 * pushing the body-bearing endpoint after `response.text()` resolves.
 * @param captured - Live pool the late body is appended to.
 * @param bodyHit - Body-bearing endpoint to append after the match.
 * @returns Fake Playwright page.
 */
function makeMatchPage(captured: IDiscoveredEndpoint[], bodyHit: IDiscoveredEndpoint): Page {
  /**
   * Resolve on headers; schedule the late body append.
   * @returns Resolved response (value discarded by awaitTraffic).
   */
  const waitForResponse = (): Promise<Response> => {
    /**
     * Append the body-bearing endpoint to the live pool.
     * @returns New pool length (ignored).
     */
    const appendBody = (): number => captured.push(bodyHit);
    globalThis.setTimeout(appendBody, 5);
    return Promise.resolve({} as Response);
  };
  return { waitForResponse } as unknown as Page;
}

/**
 * Fake page whose `waitForResponse` rejects with a Playwright timeout —
 * mirrors no matching response arriving within the budget.
 * @returns Fake Playwright page.
 */
function makeTimeoutPage(): Page {
  /**
   * Reject with a TimeoutError (no match within budget).
   * @returns Rejected promise.
   */
  const waitForResponse = (): Promise<Response> =>
    Promise.reject(new errors.TimeoutError('Timeout 20000ms exceeded'));
  return { waitForResponse } as unknown as Page;
}

/**
 * Fake page whose `waitForResponse` rejects with a terminal non-timeout
 * failure — mirrors the page/context being closed mid-wait.
 * @returns Fake Playwright page.
 */
function makeClosedPage(): Page {
  /**
   * Reject with a closure error (not a timeout).
   * @returns Rejected promise.
   */
  const waitForResponse = (): Promise<Response> =>
    Promise.reject(new Error('Target page, context or browser has been closed'));
  return { waitForResponse } as unknown as Page;
}

/**
 * Fake page recording whether `waitForResponse` was invoked — proves
 * the immediate fast-path returns before any forward wait.
 * @param calls - Mutable counter incremented on each call.
 * @param calls.count - Invocation count of `waitForResponse`.
 * @returns Fake Playwright page.
 */
function makeSpyPage(calls: { count: number }): Page {
  /**
   * Record the call; never settle (must not be reached on fast-path).
   * @returns Never-settling promise.
   */
  const waitForResponse = (): Promise<Response> => {
    calls.count += 1;
    return Promise.race([]);
  };
  return { waitForResponse } as unknown as Page;
}

describe('awaitTraffic header-vs-body read race', () => {
  it('re-polls and finds the hit when the body lands after the URL match', async () => {
    const captured: IDiscoveredEndpoint[] = [];
    const bodyHit = makeCapture(ACCOUNTS_URL);
    const page = makeMatchPage(captured, bodyHit);
    const result = await awaitTraffic({ page, captured, patterns: [GET_CARD_LIST] }, 20_000);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.url).toContain('GetCardList');
    }
  });

  it('fails fast on timeout without adding a settle wait (honest fast-fail)', async () => {
    const captured: IDiscoveredEndpoint[] = [];
    const page = makeTimeoutPage();
    const start = Date.now();
    const result = await awaitTraffic({ page, captured, patterns: [GET_CARD_LIST] }, 20_000);
    expect(result).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('rethrows non-timeout failures (page/context closed) instead of swallowing them', async () => {
    const captured: IDiscoveredEndpoint[] = [];
    const page = makeClosedPage();
    const pending = awaitTraffic({ page, captured, patterns: [GET_CARD_LIST] }, 20_000);
    await expect(pending).rejects.toThrow('has been closed');
  });

  it('returns the existing pool hit immediately without waiting on the page', async () => {
    const bodyHit = makeCapture(ACCOUNTS_URL);
    const calls = { count: 0 };
    const page = makeSpyPage(calls);
    const result = await awaitTraffic(
      { page, captured: [bodyHit], patterns: [GET_CARD_LIST] },
      20_000,
    );
    expect(result).not.toBe(false);
    expect(calls.count).toBe(0);
  });
});
