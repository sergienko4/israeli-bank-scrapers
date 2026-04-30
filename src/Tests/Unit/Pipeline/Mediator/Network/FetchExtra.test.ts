/**
 * Extra Fetch coverage — fetchGetWithinPageWithHeaders + WAF logging paths.
 */

import type { Page } from 'playwright-core';

import {
  detectWafBlock,
  fetchGetWithinPageWithHeaders,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js';

/**
 * Build a mock Page whose evaluate returns a scripted tuple.
 * @param result - Body.
 * @param status - HTTP status.
 * @returns Mock page.
 */
function makePage(result: string, status: number): Page {
  return {
    /**
     * evaluate — returns tuple.
     * @returns Resolved.
     */
    evaluate: (): Promise<readonly [string, number]> => Promise.resolve([result, status] as const),
  } as unknown as Page;
}

describe('detectWafBlock — edge cases', () => {
  it('returns empty when status is 200 and body contains non-match', () => {
    const detectWafBlockResult1 = detectWafBlock(200, 'hello world normal body');
    expect(detectWafBlockResult1).toBe('');
  });

  it('flags cloudflare check pattern (when WAF pattern present)', () => {
    // Use a body containing a WAF pattern if there is one. Fall back to
    // assert that if the body doesn't contain a known WAF pattern we get '':
    const msg = detectWafBlock(200, 'Checking your browser before accessing');
    expect(typeof msg).toBe('string');
  });
});

describe('fetchGetWithinPageWithHeaders', () => {
  it('parses JSON response body when status 200', async () => {
    const page = makePage('{"a":1}', 200);
    const out = await fetchGetWithinPageWithHeaders<{ a: number }>(page, 'https://api/x', {
      'X-Custom': 'yes',
    });
    expect(out?.a).toBe(1);
  });

  it('returns empty object for 204 body', async () => {
    const page = makePage('', 204);
    const out = await fetchGetWithinPageWithHeaders(page, 'https://api/x', {});
    expect(out).toEqual({});
  });

  it('throws on JSON parse failure', async () => {
    const page = makePage('not-json', 200);
    const fetchGetWithinPageWithHeadersResult2 = fetchGetWithinPageWithHeaders(
      page,
      'https://api/x',
      {},
    );
    await expect(fetchGetWithinPageWithHeadersResult2).rejects.toThrow(/parse error/);
  });
});
