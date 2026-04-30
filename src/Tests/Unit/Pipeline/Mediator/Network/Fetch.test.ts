/**
 * Unit tests for Fetch — HTTP helpers + WAF detection + within-page fetch.
 */

import type { Page } from 'playwright-core';

import {
  detectWafBlock,
  fetchGet,
  fetchGetWithinPage,
  fetchGraphql,
  fetchPost,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js';

/** Global fetch captured for restoration. */
const REAL_FETCH = globalThis.fetch;

/** Captured mock response builder. */
interface IMockResponseInit {
  status: number;
  body: string;
}

/**
 * Replace global fetch with a stub returning the given response.
 * @param init - Status + body to return.
 * @returns Restore function.
 */
function stubFetch(init: IMockResponseInit): () => boolean {
  /**
   * Mocked fetch implementation.
   * @returns Resolved mock response.
   */
  const stub: typeof fetch = (): Promise<Response> =>
    Promise.resolve({
      status: init.status,
      /**
       * Response body text accessor.
       * @returns Resolved body string.
       */
      text: (): Promise<string> => Promise.resolve(init.body),
    } as unknown as Response);
  globalThis.fetch = stub;
  return (): boolean => {
    globalThis.fetch = REAL_FETCH;
    return true;
  };
}

/**
 * Build a mock Page whose evaluate() returns a [body, status] tuple.
 * @param result - Body text.
 * @param status - HTTP status.
 * @returns Mock page that routes evaluate to the supplied response.
 */
function makeEvaluatingPage(result: string, status: number): Page {
  return {
    /**
     * Return the mock response tuple regardless of input.
     * @returns Tuple [body, status].
     */
    evaluate: (): Promise<readonly [string, number]> => Promise.resolve([result, status] as const),
  } as unknown as Page;
}

describe('detectWafBlock', () => {
  it('does not flag 403 (permission, not WAF)', () => {
    const detectWafBlockResult1 = detectWafBlock(403, '');
    expect(detectWafBlockResult1).toBe('');
  });
  it('flags 429 status', () => {
    const detectWafBlockResult2 = detectWafBlock(429, '');
    expect(detectWafBlockResult2).toContain('429');
  });
  it('flags 503 status', () => {
    const detectWafBlockResult3 = detectWafBlock(503, '');
    expect(detectWafBlockResult3).toContain('503');
  });
  it('returns empty for 200 with clean body', () => {
    const detectWafBlockResult4 = detectWafBlock(200, 'hello world');
    expect(detectWafBlockResult4).toBe('');
  });
  it('returns empty for blank body at allowed status', () => {
    const detectWafBlockResult5 = detectWafBlock(204, '');
    expect(detectWafBlockResult5).toBe('');
  });
  it('matches response pattern substring', () => {
    const msg = detectWafBlock(200, 'Access Denied — please try later');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('fetchGet', () => {
  it('parses JSON on 200', async () => {
    const restore = stubFetch({ status: 200, body: '{"ok":true}' });
    try {
      const result = await fetchGet<{ ok: boolean }>('https://test/api', {});
      expect(result.ok).toBe(true);
    } finally {
      restore();
    }
  });

  it('throws ScraperError on non-200', async () => {
    const restore = stubFetch({ status: 500, body: '{}' });
    try {
      const fetchGetResult6 = fetchGet('https://test/api', {});
      await expect(fetchGetResult6).rejects.toThrow(/500/);
    } finally {
      restore();
    }
  });
});

describe('fetchPost', () => {
  it('serializes body and parses JSON response', async () => {
    const restore = stubFetch({ status: 200, body: '{"x":1}' });
    try {
      const result = await fetchPost<{ x: number }>('https://test/api', { q: 'hi' });
      expect(result.x).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('fetchGraphql', () => {
  it('throws on GraphQL errors', async () => {
    const restore = stubFetch({
      status: 200,
      body: '{"data":null,"errors":[{"message":"bad query"}]}',
    });
    try {
      const fetchGraphqlResult7 = fetchGraphql('https://g', 'query');
      await expect(fetchGraphqlResult7).rejects.toThrow(/bad query/);
    } finally {
      restore();
    }
  });

  it('returns data on success', async () => {
    const restore = stubFetch({ status: 200, body: '{"data":{"ok":true}}' });
    try {
      const out = await fetchGraphql<{ ok: boolean }>('https://g', 'query');
      expect(out.ok).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('fetchGetWithinPage', () => {
  it('parses JSON response body', async () => {
    const page = makeEvaluatingPage('{"a":1}', 200);
    const out = await fetchGetWithinPage<{ a: number }>(page, 'https://api/x');
    expect(out?.a).toBe(1);
  });

  it('returns empty object for empty body (204-like)', async () => {
    const page = makeEvaluatingPage('', 204);
    const out = await fetchGetWithinPage<Record<string, unknown>>(page, 'https://api/x');
    expect(out).toEqual({});
  });

  it('throws on parse failure when errors not ignored', async () => {
    const page = makeEvaluatingPage('not-json', 200);
    const fetchGetWithinPageResult8 = fetchGetWithinPage(page, 'https://api/x');
    await expect(fetchGetWithinPageResult8).rejects.toThrow(/parse error/);
  });

  it('returns null on parse failure when errors ignored', async () => {
    const page = makeEvaluatingPage('broken', 200);
    const out = await fetchGetWithinPage(page, 'https://api/x', true);
    expect(out).toBeNull();
  });
});

describe('fetchPostWithinPage', () => {
  it('parses JSON response', async () => {
    const page = makeEvaluatingPage('{"ok":true}', 200);
    const out = await fetchPostWithinPage<{ ok: boolean }>(page, 'https://api/x', { data: {} });
    expect(out?.ok).toBe(true);
  });

  it('returns empty object for 204', async () => {
    const page = makeEvaluatingPage('', 204);
    const out = await fetchPostWithinPage(page, 'https://api/x', { data: [] });
    expect(out).toEqual({});
  });

  it('throws on parse failure when errors not ignored', async () => {
    const page = makeEvaluatingPage('not-json', 200);
    const fetchPostWithinPageResult9 = fetchPostWithinPage(page, 'https://api/x', { data: {} });
    await expect(fetchPostWithinPageResult9).rejects.toThrow(/parse error/);
  });

  it('returns null on parse failure when errors ignored', async () => {
    const page = makeEvaluatingPage('broken', 200);
    const out = await fetchPostWithinPage(page, 'https://api/x', {
      data: {},
      shouldIgnoreErrors: true,
    });
    expect(out).toBeNull();
  });

  it('supports custom extraHeaders', async () => {
    const page = makeEvaluatingPage('{}', 200);
    const out = await fetchPostWithinPage(page, 'https://api/x', {
      data: { a: 1 },
      extraHeaders: { 'X-Custom': 'yes' },
    });
    expect(out).toEqual({});
  });
});
