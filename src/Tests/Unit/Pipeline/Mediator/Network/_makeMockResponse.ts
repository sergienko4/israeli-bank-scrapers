/**
 * Shared Playwright `Response` mock factory for NetworkDiscovery tests.
 *
 * <p>Extracted from `ParseResponse204.test.ts` and `UnsupportedUrl.
 * test.ts` (CodeRabbit review on commit 2ed8a628 — DRY duplication).
 * Builds a minimal `Response` stub carrying the surface that
 * `extractRequestMeta` + `parseResponse` read: status, url,
 * `headers()`, `request().method()/postData()/headers()`, and
 * `text()`. Underscore prefix follows the project's shared-fixture
 * naming convention (`_makePhaseFixture`, `_makeBankFixture`).
 *
 * <p>Pure synchronous factory — no I/O, no global state.
 */

import type { Request, Response } from 'playwright-core';

/** Bundled args for {@link makeMockResponse}. Keeps the helper inside
 *  the 3-param ceiling and gives every field its own narrow type. */
export interface IMockArgs {
  readonly status: number;
  readonly contentType: string;
  readonly text: string;
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly postData: string;
}

/**
 * Build a minimal Playwright `Response` stub.
 *
 * @param args - Bundled mock-response fields.
 * @returns Mock Response cast to the Playwright type.
 */
export function makeMockResponse(args: IMockArgs): Response {
  /**
   * Request method accessor.
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
