/**
 * Unit tests for CookieHeaderSentinel.ts — the `@cookie:<name>` header
 * resolver used by the session HTTP transport for anti-replay banks (Hapoalim
 * X-XSRF-TOKEN ← XSRF-TOKEN cookie), its strict `@cookie-strict:` form and
 * the `?<fallback>` suffix. Pure functions; no transport mock.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  COOKIE_HEADER_SENTINEL_PREFIX,
  type CookieJar,
  cookieSentinelHeaders,
  hasCookieSentinel,
  substituteCookieHeaders,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/CookieHeaderSentinel.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

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
    const expected = succeed({ 'X-XSRF-TOKEN': 'tok-123' });
    expect(resolved).toEqual(expected);
  });

  it('passes non-sentinel headers through unchanged', () => {
    const headers = { 'content-type': 'application/json;charset=UTF-8', uuid: 'abc' };
    const resolved = substituteCookieHeaders(headers, JAR);
    const expected = succeed(headers);
    expect(resolved).toEqual(expected);
  });

  it('drops a header whose named cookie is absent from the jar', () => {
    const headers = {
      'content-type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}MISSING`,
    };
    const resolved = substituteCookieHeaders(headers, JAR);
    const expected = succeed({ 'content-type': 'application/json;charset=UTF-8' });
    expect(resolved).toEqual(expected);
  });

  it('resolves a mix of sentinel and literal headers', () => {
    const headers = {
      'content-type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`,
      uuid: 'fixed-uuid',
    };
    const resolved = substituteCookieHeaders(headers, JAR);
    const sent = { 'content-type': 'application/json;charset=UTF-8', 'X-XSRF-TOKEN': 'tok-123' };
    const expected = succeed({ ...sent, uuid: 'fixed-uuid' });
    expect(resolved).toEqual(expected);
  });
});

const STRICT_XSRF = '@cookie-strict:XSRF-TOKEN';
const UNDECODABLE = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'cookie XSRF-TOKEN undecodable',
};

/**
 * Resolve one X-XSRF-TOKEN sentinel against a jar holding one XSRF-TOKEN.
 * @param sentinel - The header value, a sentinel.
 * @param raw - The stored cookie value.
 * @returns The resolution outcome.
 */
function resolveXsrf(sentinel: string, raw: string): ReturnType<typeof substituteCookieHeaders> {
  const jar = [{ name: 'XSRF-TOKEN', value: raw }];
  return substituteCookieHeaders({ 'X-XSRF-TOKEN': sentinel }, jar);
}

describe('CookieHeaderSentinel — @cookie-strict:', () => {
  it('is a sentinel to both pickers', () => {
    const headers = { 'X-XSRF-TOKEN': STRICT_XSRF, accept: 'application/json' };
    const isPresent: boolean = hasCookieSentinel(headers);
    const picked = cookieSentinelHeaders(headers);
    expect(isPresent).toBe(true);
    expect(picked).toEqual({ 'X-XSRF-TOKEN': STRICT_XSRF });
  });

  it.each([
    { title: 'decodes an escaped value', raw: 'a%2Bb%3D%3D', sent: 'a+b==' },
    { title: 'keeps a plain value', raw: 'tok-123', sent: 'tok-123' },
    { title: 'sends an empty value', raw: '', sent: '' },
  ])('$title', ({ raw, sent }) => {
    const resolved = resolveXsrf(STRICT_XSRF, raw);
    const expected = succeed({ 'X-XSRF-TOKEN': sent });
    expect(resolved).toEqual(expected);
  });

  it.each([
    { title: 'a malformed escape', raw: '%E0%A4%A' },
    { title: 'a line break', raw: 'a%0Ab' },
    { title: 'a NUL', raw: 'a%00b' },
    { title: 'a character past Latin-1', raw: '%D7%A9' },
  ])('fails on $title, naming only the cookie', ({ raw }) => {
    const resolved = resolveXsrf(STRICT_XSRF, raw);
    const text = JSON.stringify(resolved);
    expect(resolved).toMatchObject(UNDECODABLE);
    expect(text).not.toContain(raw);
  });

  it('drops the header when the cookie is missing', () => {
    const resolved = substituteCookieHeaders({ 'X-XSRF-TOKEN': STRICT_XSRF }, []);
    const expected = succeed({});
    expect(resolved).toEqual(expected);
  });

  it.each(['a%2Bb', '%E0%A4%A'])('leaves a @cookie: value %s raw', raw => {
    const resolved = resolveXsrf('@cookie:XSRF-TOKEN', raw);
    const expected = succeed({ 'X-XSRF-TOKEN': raw });
    expect(resolved).toEqual(expected);
  });
});

/** One fallback case: the header value, the jar and the value sent. */
interface IFallbackCase {
  readonly title: string;
  readonly sentinel: string;
  readonly jar: CookieJar;
  readonly sent: string;
}

const FALLBACK_CASES: readonly IFallbackCase[] = [
  {
    title: 'sends it for a missing cookie',
    sentinel: '@cookie:language?HEBREW',
    jar: [],
    sent: 'HEBREW',
  },
  {
    title: 'sends it for an empty cookie',
    sentinel: '@cookie:language?HEBREW',
    jar: [{ name: 'language', value: '' }],
    sent: 'HEBREW',
  },
  { title: 'sends an empty fallback', sentinel: '@cookie:tuuid?', jar: [], sent: '' },
  {
    title: 'sends it verbatim, never decoded',
    sentinel: '@cookie:site?a%20b',
    jar: [],
    sent: 'a%20b',
  },
  {
    title: 'prefers a present cookie',
    sentinel: '@cookie:language?HEBREW',
    jar: [{ name: 'language', value: 'ENGLISH' }],
    sent: 'ENGLISH',
  },
  {
    title: 'ends the name at the first ?',
    sentinel: '@cookie:k?a?b',
    jar: [{ name: 'k?a', value: 'x' }],
    sent: 'a?b',
  },
  { title: 'serves a strict sentinel too', sentinel: `${STRICT_XSRF}?fb`, jar: [], sent: 'fb' },
];

describe('CookieHeaderSentinel — ?<fallback>', () => {
  it.each(FALLBACK_CASES)('$title', ({ sentinel, jar, sent }) => {
    const resolved = substituteCookieHeaders({ language: sentinel }, jar);
    const expected = succeed({ language: sent });
    expect(resolved).toEqual(expected);
  });

  it('sends an empty cookie as is without a fallback', () => {
    const jar = [{ name: 'language', value: '' }];
    const resolved = substituteCookieHeaders({ language: '@cookie:language' }, jar);
    const expected = succeed({ language: '' });
    expect(resolved).toEqual(expected);
  });

  it('still fails a strict undecodable cookie that has a fallback', () => {
    const resolved = resolveXsrf(`${STRICT_XSRF}?fb`, '%E0%A4%A');
    expect(resolved).toMatchObject(UNDECODABLE);
  });
});
