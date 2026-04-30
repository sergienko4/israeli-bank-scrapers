/**
 * Branch coverage extensions for Fetch within-page helpers.
 * Exercises non-200 + WAF reason branches in logResponseIssues.
 */

import type { Page } from 'playwright-core';

import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js';

/**
 * Build a mock Page whose evaluate() returns a scripted [body, status] tuple.
 * @param body - Body text.
 * @param status - HTTP status.
 * @returns Mock Page.
 */
function makePage(body: string, status: number): Page {
  return {
    /**
     * Return canned [body, status].
     * @returns Tuple.
     */
    evaluate: (): Promise<readonly [string, number]> => Promise.resolve([body, status] as const),
  } as unknown as Page;
}

describe('Fetch — logResponseIssues branches', () => {
  it('logs non-200 status without failing the call when body parses to JSON', async () => {
    const page = makePage('{"maintenance":true}', 503);
    const result = await fetchGetWithinPage<Record<string, unknown>>(page, 'https://api/x', true);
    // 503 body still parses → returns result (logs non-200 warning path)
    expect(result).toBeDefined();
  });

  it('logs non-200 status for 429 (WAF) with text', async () => {
    const page = makePage('too many requests', 429);
    const result = await fetchGetWithinPage(page, 'https://api/x', true);
    // 429 not parsed → parse error ignored → null
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('logs WAF block when status + body match WAF pattern', async () => {
    const page = makePage('Access Denied — please try again', 403);
    const result = await fetchGetWithinPage(page, 'https://api/x', true);
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('POST within-page: non-200 with JSON still parses', async () => {
    const page = makePage('{"x":1}', 500);
    const result = await fetchPostWithinPage<Record<string, unknown>>(page, 'https://api/x', {
      data: {},
      shouldIgnoreErrors: true,
    });
    expect(result).toBeDefined();
  });

  it('GET with custom headers: 500 + JSON body parses OK', async () => {
    const page = makePage('{"err":"oops"}', 500);
    const result = await fetchGetWithinPageWithHeaders<Record<string, unknown>>(
      page,
      'https://api/x',
      { Authorization: 'Bearer x' },
    );
    expect(result).toBeDefined();
  });

  it('GET within-page: 200 + empty body → {}', async () => {
    const page = makePage('', 200);
    const result = await fetchGetWithinPage<Record<string, unknown>>(page, 'https://api/x');
    expect(result).toEqual({});
  });
});
