/**
 * Unit tests for CookieJar — generic host-scoped cookie store.
 * Written BEFORE the source (Rule #9 — tests first).
 * Generic, no bank-specific coupling (Rule #11).
 */

import { createCookieJar } from '../../../../../Scrapers/Pipeline/Banks/_Shared/CookieJar.js';

describe('createCookieJar', () => {
  it('empty jar reports size=0 and emits an empty Cookie header', () => {
    const jar = createCookieJar();
    const size = jar.size();
    const header = jar.cookieHeader();
    expect(size).toBe(0);
    expect(header).toBe('');
  });

  it('adds a plain Set-Cookie value and emits it on cookieHeader', () => {
    const jar = createCookieJar();
    jar.add(['ts_hwid=abc123']);
    const size = jar.size();
    const header = jar.cookieHeader();
    expect(size).toBe(1);
    expect(header).toBe('ts_hwid=abc123');
  });

  it('strips Expires / Path / Domain / Secure / HttpOnly attributes', () => {
    const jar = createCookieJar();
    jar.add(['ts_hwid=abc; Expires=Fri, 23 Apr 2027 16:11:04 GMT; Path=/; Secure; HttpOnly']);
    const header = jar.cookieHeader();
    expect(header).toBe('ts_hwid=abc');
  });

  it('later Set-Cookie with same name overwrites the earlier value', () => {
    const jar = createCookieJar();
    jar.add(['k=v1']);
    jar.add(['k=v2; Path=/']);
    const size = jar.size();
    const header = jar.cookieHeader();
    expect(size).toBe(1);
    expect(header).toBe('k=v2');
  });

  it('emits multiple cookies joined by "; "', () => {
    const jar = createCookieJar();
    jar.add(['a=1; Path=/', 'b=2; Domain=.x.y', 'c=3']);
    const header = jar.cookieHeader();
    const parts = header.split('; ').sort();
    expect(parts).toEqual(['a=1', 'b=2', 'c=3']);
  });

  it('ignores empty strings and malformed entries', () => {
    const jar = createCookieJar();
    jar.add(['', '  ', 'garbage-without-equals', 'valid=yes']);
    const size = jar.size();
    const header = jar.cookieHeader();
    expect(size).toBe(1);
    expect(header).toBe('valid=yes');
  });

  it('tolerates leading whitespace in Set-Cookie', () => {
    const jar = createCookieJar();
    jar.add(['   ts_hwid=abc']);
    const header = jar.cookieHeader();
    expect(header).toBe('ts_hwid=abc');
  });

  it('cookies with "=" in their value survive intact', () => {
    const jar = createCookieJar();
    jar.add(['token=abc=def=ghi; Path=/']);
    const header = jar.cookieHeader();
    expect(header).toBe('token=abc=def=ghi');
  });

  it('two independently created jars keep separate state', () => {
    const j1 = createCookieJar();
    const j2 = createCookieJar();
    j1.add(['a=1']);
    const s1 = j1.size();
    const s2 = j2.size();
    expect(s1).toBe(1);
    expect(s2).toBe(0);
  });
});
