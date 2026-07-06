/**
 * Unit tests for CookieHeaderSentinel.ts — the `@cookie:<name>` header
 * resolver used by BrowserFetchStrategy for anti-replay banks (Hapoalim
 * X-XSRF-TOKEN ← XSRF-TOKEN cookie). Pure functions — no Page mock.
 */

import {
  COOKIE_HEADER_SENTINEL_PREFIX,
  hasCookieSentinel,
  substituteCookieHeaders,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/CookieHeaderSentinel.js';

const JAR = [
  { name: 'XSRF-TOKEN', value: 'tok-123' },
  { name: 'JSESSIONID', value: 'sess-abc' },
] as const;

describe('CookieHeaderSentinel/hasCookieSentinel', () => {
  it('is true when a header value carries the sentinel prefix', () => {
    const headers = { 'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN` };
    const isPresent: boolean = hasCookieSentinel(headers);
    expect(isPresent).toBe(true);
  });

  it('is false when no header value is a sentinel', () => {
    const headers = { 'content-type': 'application/json;charset=UTF-8', uuid: 'abc' };
    const isPresent: boolean = hasCookieSentinel(headers);
    expect(isPresent).toBe(false);
  });

  it('is false for an empty header map', () => {
    const isPresent: boolean = hasCookieSentinel({});
    expect(isPresent).toBe(false);
  });
});

describe('CookieHeaderSentinel/substituteCookieHeaders', () => {
  it('substitutes the named cookie value into the header', () => {
    const headers = { 'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN` };
    const resolved = substituteCookieHeaders(headers, JAR);
    expect(resolved).toEqual({ 'X-XSRF-TOKEN': 'tok-123' });
  });

  it('passes non-sentinel headers through unchanged', () => {
    const headers = { 'content-type': 'application/json;charset=UTF-8', uuid: 'abc' };
    const resolved = substituteCookieHeaders(headers, JAR);
    expect(resolved).toEqual(headers);
  });

  it('drops a header whose named cookie is absent from the jar', () => {
    const headers = {
      'content-type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}MISSING`,
    };
    const resolved = substituteCookieHeaders(headers, JAR);
    expect(resolved).toEqual({
      'content-type': 'application/json;charset=UTF-8',
    });
  });

  it('resolves a mix of sentinel and literal headers', () => {
    const headers = {
      'content-type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`,
      uuid: 'fixed-uuid',
    };
    const resolved = substituteCookieHeaders(headers, JAR);
    expect(resolved).toEqual({
      'content-type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': 'tok-123',
      uuid: 'fixed-uuid',
    });
  });
});
