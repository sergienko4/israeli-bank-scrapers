/**
 * Unit tests — WK_AUTH_POST_OR_PUT_REQUEST matches `.ashx` auth servlet.
 *
 * Regression guard: Amex and Isracard submit credentials through
 * `/services/ProxyRequestHandler.ashx` (not the 7 WK auth patterns
 * that cover Beinleumi/Discount/Hapoalim/Max/VisaCal). Without the
 * `TRACE_AUTH_SERVLET_PATTERNS` extension the gated request trace is
 * silent for both card-family banks.
 */

import type { Request } from 'playwright-core';

import { WK_AUTH_POST_OR_PUT_REQUEST } from '../../../../../../Scrapers/Pipeline/Mediator/Network/DiscoveryEngine/PostInterceptor.js';

/**
 * Build a minimal Playwright Request stub for predicate testing.
 * @param url - Request URL.
 * @param method - HTTP method.
 * @returns Request stub cast through unknown (no `as any`).
 */
function makeRequest(url: string, method: string): Request {
  /** Resolve the request URL.
   * @returns Request URL. */
  const urlFn = (): string => url;
  /** Resolve the request method.
   * @returns Request method. */
  const methodFn = (): string => method;
  return { url: urlFn, method: methodFn } as unknown as Request;
}

describe('WK_AUTH_POST_OR_PUT_REQUEST.matches — ashx auth-servlet extension', () => {
  it('matches POST to the Amex ProxyRequestHandler.ashx auth servlet', () => {
    const req = makeRequest(
      'https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx?reqName=performLogon',
      'POST',
    );
    const isMatch = WK_AUTH_POST_OR_PUT_REQUEST.matches(req);
    expect(isMatch).toBe(true);
  });

  it('matches POST to the Isracard ProxyRequestHandler.ashx auth servlet', () => {
    const req = makeRequest(
      'https://digital.isracard.co.il/services/ProxyRequestHandler.ashx?reqName=performLogonI',
      'POST',
    );
    const isMatch = WK_AUTH_POST_OR_PUT_REQUEST.matches(req);
    expect(isMatch).toBe(true);
  });

  it('rejects GET to the .ashx auth servlet — method gate still enforced', () => {
    const req = makeRequest(
      'https://digital.isracard.co.il/services/ProxyRequestHandler.ashx?reqName=performLogon',
      'GET',
    );
    const isMatch = WK_AUTH_POST_OR_PUT_REQUEST.matches(req);
    expect(isMatch).toBe(false);
  });

  it('rejects POST to a first-party non-auth endpoint — no false positives', () => {
    const req = makeRequest('https://web.americanexpress.co.il/api/v1/GetContent', 'POST');
    const isMatch = WK_AUTH_POST_OR_PUT_REQUEST.matches(req);
    expect(isMatch).toBe(false);
  });

  it('still matches the original WK auth patterns — no regression on 7 banks', () => {
    const req = makeRequest(
      'https://www.mercantile.co.il/MatafLeumiMutavim/authentication/login',
      'POST',
    );
    const isMatch = WK_AUTH_POST_OR_PUT_REQUEST.matches(req);
    expect(isMatch).toBe(true);
  });
});
