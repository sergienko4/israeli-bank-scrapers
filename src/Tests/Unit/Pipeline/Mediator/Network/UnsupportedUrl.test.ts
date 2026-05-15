/**
 * Failing-first contract test per debugging-guidlines.md §1.2.
 *
 * <p>User direction 15-05-2026 (Amex live run `15-05-2026_15022915`):
 * we removed `.ashx` support long ago — every migrated bank goes
 * through modern POST/GET endpoints. Amex's `ProxyRequestHandler.ashx`
 * legacy auth tier MUST NOT enter the captured pool so no downstream
 * picker / probe / extractor can ever use it.
 *
 * <p>RED on prior code: `.ashx` URLs were recorded into the captured
 * pool just like any other JSON/204 response.
 *
 * <p>GREEN after fix: `parseResponse` drops `.ashx` URLs at entry
 * with `event:'parseResponse.drop' reason:'unsupportedUrl'`.
 */

import type { Request, Response } from 'playwright-core';

import {
  isUnsupportedUrl,
  parseResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

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
 * `parseResponse` reads.
 * @param args - Bundled mock fields.
 * @returns Mock Response cast to the Playwright type.
 */
function makeMockResponse(args: IMockArgs): Response {
  /**
   * Request method accessor for the Playwright Request stub.
   * @returns Configured HTTP method.
   */
  const requestMethod = (): string => args.method;
  /**
   * Request postData accessor — empty string maps to Playwright's
   * `false` sentinel so the body branch in `extractRequestMeta` is
   * exercised the same way as in production.
   * @returns Configured POST body, or false when empty.
   */
  const requestPostData = (): string | false => {
    if (args.postData.length > 0) return args.postData;
    return false;
  };
  /**
   * Request headers accessor — empty for test isolation.
   * @returns Empty header map.
   */
  const requestHeaders = (): Record<string, string> => ({});
  /**
   * Assemble the minimal Playwright Request stub.
   * @returns Request stub with the accessors `extractRequestMeta` reads.
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
   * Response headers accessor — carries only the configured
   * content-type so `extractRequestMeta` defaults to the
   * `NO_CONTENT_TYPE` sentinel when none was supplied.
   * @returns Header map.
   */
  const buildHeaders = (): Record<string, string> => {
    if (args.contentType.length === 0) return {};
    return { 'content-type': args.contentType };
  };
  /**
   * Response status accessor.
   * @returns Configured HTTP status code.
   */
  const responseStatus = (): number => args.status;
  /**
   * Response URL accessor.
   * @returns Configured URL.
   */
  const responseUrl = (): string => args.url;
  /**
   * Response body-text accessor — pre-resolved so the lint
   * `require-await` rule passes without an artificial await.
   * @returns Pre-resolved promise carrying the configured body text.
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

const ASHX_URL =
  'https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx?reqName=ValidateIdDataNoReg';
const MODERN_URL =
  'https://web.americanexpress.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList';

describe('isUnsupportedUrl — WK `.ashx` block list', () => {
  it('UU-ASHX-001 matches Amex ProxyRequestHandler.ashx with reqName query', (): void => {
    const isMatch = isUnsupportedUrl(ASHX_URL);
    expect(isMatch).toBe(true);
  });

  it('UU-ASHX-002 matches a bare `.ashx` path with no query string', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/foo.ashx');
    expect(isMatch).toBe(true);
  });

  it('UU-ASHX-003 is case-insensitive (`.ASHX`)', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/Handler.ASHX?x=1');
    expect(isMatch).toBe(true);
  });

  it('UU-MODERN-001 does NOT match Amex modern ocp/transactions endpoint', (): void => {
    const isMatch = isUnsupportedUrl(MODERN_URL);
    expect(isMatch).toBe(false);
  });

  it('UU-MODERN-002 does NOT match a path that merely contains "ashx" as a substring', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/cashbacks');
    expect(isMatch).toBe(false);
  });
});

describe('parseResponse — `.ashx` enforcement gate', () => {
  it('PR-ASHX-001 drops Amex ProxyRequestHandler.ashx response BEFORE shouldRecordResponse', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 200,
      contentType: 'application/json',
      text: '{"Header":{"Status":"1"}}',
      url: ASHX_URL,
      method: 'POST',
      postData: '{"id":"X","sisma":"Y"}',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).toBe(false);
  });

  it('PR-ASHX-002 drops `.ashx` even on status=204 (which would otherwise be recordable)', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 204,
      contentType: '',
      text: '',
      url: ASHX_URL,
      method: 'POST',
      postData: '',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).toBe(false);
  });

  it('PR-ASHX-003 still records the modern (non-ashx) endpoint with identical body', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 200,
      contentType: 'application/json',
      text: '{"transactions":[]}',
      url: MODERN_URL,
      method: 'POST',
      postData: '{}',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).not.toBe(false);
    if (endpoint !== false) {
      expect(endpoint.url).toBe(MODERN_URL);
    }
  });
});
