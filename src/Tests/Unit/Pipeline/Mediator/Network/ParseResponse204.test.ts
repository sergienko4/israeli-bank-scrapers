/**
 * Diagnostic test per debugging-guidlines.md §1.2 ("Write a failing
 * test BEFORE fixing"). Live Hapoalim run `15-05-2026_11025238`
 * showed the bank's real txn URL fired as POST with status 204
 * but never entered the captured pool (`tier='none', matches=1`
 * post-fix), meaning `parseResponse` returned `false` despite the
 * status===204 short-circuit. This test pins ground truth.
 *
 * <p>Mocks a minimal Playwright `Response` with status=204 + empty
 * body + 'none' content-type (the live shape). Asserts
 * `parseResponse` returns an `IDiscoveredEndpoint` with
 * `responseBody === null`.
 */

import type { Request, Response } from 'playwright-core';

import { parseResponse } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/** Bundled args for `makeMockResponse` — keeps the helper inside the
 *  3-param ceiling and gives every field its own narrow type. */
interface IMockArgs {
  readonly status: number;
  readonly contentType: string;
  readonly text: string;
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly postData: string;
}

/**
 * Build a minimal Playwright `Response` stub with the surface
 * `parseResponse` reads: status, headers, url, request().method(),
 * request().postData(), request().headers(), and text().
 *
 * @param args - Bundled mock-response fields.
 * @returns Mock Response cast to the Playwright type.
 */
function makeMockResponse(args: IMockArgs): Response {
  /**
   * Mock request stub — minimal surface used by `extractRequestMeta`.
   * @returns Request stub with the fields the function reads.
   */
  /**
   * Request-method accessor.
   * @returns Configured HTTP method.
   */
  const requestMethod = (): string => args.method;
  /**
   * Request-postData accessor — Playwright returns false for empty.
   * @returns Configured POST body string, or false when empty.
   */
  const requestPostData = (): string | false => {
    if (args.postData.length > 0) return args.postData;
    return false;
  };
  /**
   * Request-headers accessor — empty for test isolation.
   * @returns Empty header map.
   */
  const requestHeaders = (): Record<string, string> => ({});
  /**
   * Build the Playwright `Request` stub used by `extractRequestMeta`.
   * @returns Minimal Request stub.
   */
  const makeRequest = (): Request => {
    const stub = {
      method: requestMethod,
      postData: requestPostData,
      headers: requestHeaders,
    } as unknown as Request;
    return stub;
  };
  /**
   * Build a header map carrying ONLY the content-type the test
   * configured. Empty string → no header at all (matches a real 204).
   * @returns Header map.
   */
  const buildHeaders = (): Record<string, string> => {
    if (args.contentType.length === 0) return {};
    return { 'content-type': args.contentType };
  };
  /**
   * Response-status accessor.
   * @returns Configured HTTP status code.
   */
  const responseStatus = (): number => args.status;
  /**
   * Response-URL accessor.
   * @returns Configured URL.
   */
  const responseUrl = (): string => args.url;
  /**
   * Response-text accessor — Playwright resolves async; we return a
   * pre-resolved promise so the lint `require-await` rule passes
   * without an artificial await.
   * @returns Configured body text.
   */
  const responseText = (): Promise<string> => Promise.resolve(args.text);
  const stub = {
    status: responseStatus,
    headers: buildHeaders,
    url: responseUrl,
    request: makeRequest,
    text: responseText,
  } as unknown as Response;
  return stub;
}

/** Synthetic args helper — sets the live-Hapoalim shape defaults. */
const DEFAULT_ARGS: IMockArgs = {
  status: 200,
  contentType: '',
  text: '',
  url: 'https://bank.fake.example/api/txns',
  method: 'POST',
  postData: '',
};

describe('parseResponse — diagnostic for live 204 drop (debugging-guidlines.md §1.2)', () => {
  it('PR-204-NO-CONTENT-TYPE returns endpoint with responseBody=null for status=204 + no content-type', async (): Promise<void> => {
    const mock = makeMockResponse({ ...DEFAULT_ARGS, status: 204 });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toBeNull();
      expect(result.status).toBe(204);
      expect(result.url).toBe('https://bank.fake.example/api/txns');
    }
  });

  it('PR-204-WITH-CONTENT-TYPE returns endpoint for status=204 + application/json', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 204,
      contentType: 'application/json',
    });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toBeNull();
    }
  });

  it('PR-200-JSON returns endpoint with body for status=200 + application/json + valid JSON', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 200,
      contentType: 'application/json',
      text: '{"transactions":[]}',
    });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toEqual({ transactions: [] });
      expect(result.status).toBe(200);
    }
  });

  it('PR-200-IMAGE returns false for binary asset (existing JSON-only filter)', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 200,
      contentType: 'image/png',
    });
    const result = await parseResponse(mock);

    expect(result).toBe(false);
  });
});
