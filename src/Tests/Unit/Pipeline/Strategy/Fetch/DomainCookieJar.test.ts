/**
 * Unit tests for Strategy/Fetch/DomainCookieJar — the RFC 6265 subset jar a
 * bank opts into with `cookieDomains`: domain cookies limited to the
 * allow-list, host-only cookies, default path, path boundary, Secure, expiry,
 * same-key replacement, and export/import/clear. Pure — no transport.
 */

import { jest } from '@jest/globals';

import { createDomainCookieJar } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/DomainCookieJar.js';
import type { IStoredCookie } from '../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';

const BASE = 'https://www.bank.example/';
const ALLOW = ['bank.example'] as const;
const WWW = 'https://www.bank.example/login/index.html';
const MTO = 'https://mto.bank.example/Online/api/x';
const APEX = 'https://bank.example/home';

/**
 * A jar over the shared base URL and allow-list.
 * @returns A fresh jar.
 */
function makeJar(): ReturnType<typeof createDomainCookieJar> {
  return createDomainCookieJar(BASE, ALLOW);
}

/**
 * A stored cookie with test defaults.
 * @param over - Fields to override.
 * @returns The stored cookie.
 */
function stored(over: Partial<IStoredCookie>): IStoredCookie {
  const base: IStoredCookie = {
    name: 'a',
    value: '1',
    domain: 'www.bank.example',
    path: '/',
    hostOnly: true,
    secure: true,
    expiresEpochS: 0,
  };
  return { ...base, ...over };
}

describe('DomainCookieJar/domain scope', () => {
  it('sends an allow-listed parent-domain cookie to a sibling host', () => {
    const jar = makeJar();
    jar.add(WWW, ['XSRF=t1; Domain=.bank.example; Path=/']);
    const header = jar.header(MTO);
    expect(header).toBe('XSRF=t1');
  });

  it.each([
    ['Domain = .bank.example', 'XSRF=t1'],
    ['Domain=evil.example; DOMAIN = .bank.example ', 'XSRF=t1'],
    ['Domain=bank.example; Domain = evil.example', ''],
  ])('honors the last spaced domain attribute: %s', (attributes, expected) => {
    const jar = makeJar();
    jar.add(WWW, [`XSRF=t1; ${attributes}; Path=/`]);
    const header = jar.header(MTO);
    expect(header).toBe(expected);
  });

  it('never sends it to a foreign host or a host that only ends with the domain', () => {
    const jar = makeJar();
    jar.add(WWW, ['XSRF=t1; Domain=bank.example; Path=/']);
    const evil = jar.header('https://evil.example/');
    const lookalike = jar.header('https://xbank.example/');
    expect([evil, lookalike]).toEqual(['', '']);
  });

  it('ignores a Domain the request host does not match', () => {
    const jar = makeJar();
    jar.add(WWW, ['x=1; Domain=evil.example']);
    const exported = jar.exportAll();
    expect(exported).toEqual([]);
  });

  it('ignores a parent Domain outside the allow-list', () => {
    const jar = makeJar();
    jar.add('https://www.other.example/', ['x=1; Domain=other.example']);
    const exported = jar.exportAll();
    expect(exported).toEqual([]);
  });

  it('keeps a Domain equal to a non-allow-listed host as host-only', () => {
    const jar = makeJar();
    jar.add('https://api.other.example/', ['x=1; Domain=api.other.example']);
    const own = jar.header('https://api.other.example/');
    const child = jar.header('https://x.api.other.example/');
    expect([own, child]).toEqual(['x=1', '']);
  });

  it('keeps a cookie without Domain host-only', () => {
    const jar = makeJar();
    jar.add(WWW, ['sid=s1; Path=/']);
    const own = jar.header(WWW);
    const sibling = jar.header(MTO);
    expect([own, sibling]).toEqual(['sid=s1', '']);
  });

  it('resolves a relative request URL against the base', () => {
    const jar = makeJar();
    jar.add('login/index.html', ['sid=s1']);
    const header = jar.header(WWW);
    expect(header).toBe('sid=s1');
  });

  it('neither keeps nor sends a cookie for an unparseable URL', () => {
    const jar = makeJar();
    jar.add('http://[bad', ['sid=s1']);
    const header = jar.header('http://[bad');
    const exported = jar.exportAll();
    expect([header, exported.length]).toEqual(['', 0]);
  });
});

describe('DomainCookieJar/path scope', () => {
  it('defaults the path to the request directory', () => {
    const jar = makeJar();
    jar.add('https://www.bank.example/login/api/Login', ['t=1']);
    const inside = jar.header('https://www.bank.example/login/api/Other');
    const outside = jar.header('https://www.bank.example/home');
    expect([inside, outside]).toEqual(['t=1', '']);
  });

  it('matches a path only on a slash boundary', () => {
    const jar = makeJar();
    jar.add(WWW, ['t=1; Path=/Online']);
    const exact = jar.header('https://www.bank.example/Online');
    const child = jar.header('https://www.bank.example/Online/x');
    const evil = jar.header('https://www.bank.example/OnlineEvil');
    expect([exact, child, evil]).toEqual(['t=1', 't=1', '']);
  });

  it('keeps the complete last spaced Path value', () => {
    const jar = makeJar();
    jar.add(WWW, ['t=1; Path=/; Path = /Online/key=value ']);
    const inside = jar.header('https://www.bank.example/Online/key=value/next');
    const outside = jar.header('https://www.bank.example/Online/key/next');
    expect([inside, outside]).toEqual(['t=1', '']);
  });

  it('keeps same-name cookies of different paths, longer path first', () => {
    const jar = makeJar();
    jar.add(WWW, ['t=root; Path=/', 't=deep; Path=/Online']);
    const header = jar.header('https://www.bank.example/Online/x');
    expect(header).toBe('t=deep; t=root');
  });
});

describe('DomainCookieJar/replacement', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('replaces a host-only cookie with a Domain cookie of the same key', () => {
    const jar = makeJar();
    jar.add(APEX, ['t=host; Path=/']);
    jar.add(APEX, ['t=dom; Domain=bank.example; Path=/']);
    const exported = jar.exportAll();
    const sub = jar.header(WWW);
    expect([exported.length, sub]).toEqual([1, 't=dom']);
  });

  it('replaces a Domain cookie with a host-only cookie of the same key', () => {
    const jar = makeJar();
    jar.add(APEX, ['t=dom; Domain=bank.example; Path=/']);
    jar.add(APEX, ['t=host; Path=/']);
    const exported = jar.exportAll();
    const sub = jar.header(WWW);
    expect([exported.length, sub]).toEqual([1, '']);
  });

  it.each([
    { label: 'expired', maxAge: 1, header: 'sid=domain; sid=new', value: 'domain' },
    { label: 'live', maxAge: 60, header: 'sid=new; sid=domain', value: 'new' },
  ])('orders a replacement of the $label cookie by creation time', ({ maxAge, header, value }) => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const jar = makeJar();
    jar.add(WWW, [`sid=old; Max-Age=${String(maxAge)}; Path=/`]);
    jar.add(WWW, ['sid=domain; Domain=bank.example; Path=/']);
    clock.mockReturnValue(1_002_000);
    jar.add(WWW, ['sid=new; Path=/']);
    const sent = jar.header(WWW);
    const token = jar.cookieFor(WWW, 'sid');
    expect(sent).toBe(header);
    expect(token).toEqual({ has: true, value });
  });
});

describe('DomainCookieJar/secure and expiry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never sends a Secure cookie over http', () => {
    const jar = makeJar();
    jar.add(WWW, ['s=1; Secure; Path=/']);
    const plain = jar.header('http://www.bank.example/');
    const tls = jar.header(WWW);
    expect([plain, tls]).toEqual(['', 's=1']);
  });

  it('refuses an http response that would replace a stored Secure cookie', () => {
    const jar = makeJar();
    jar.add(WWW, ['sid=secure; Secure; Path=/']);
    jar.add('http://www.bank.example/login', ['sid=plain; Path=/']);
    const header = jar.header(WWW);
    expect(header).toBe('sid=secure');
  });

  it('lets an https response replace a stored Secure cookie', () => {
    const jar = makeJar();
    jar.add(WWW, ['sid=old; Secure; Path=/']);
    jar.add(WWW, ['sid=new; Path=/']);
    const header = jar.header(WWW);
    expect(header).toBe('sid=new');
  });

  it('lets an http response replace an expired Secure cookie', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const jar = makeJar();
    jar.add(WWW, ['sid=secure; Secure; Max-Age=1; Path=/']);
    clock.mockReturnValue(1_002_000);
    const expired = jar.header(WWW);
    jar.add('http://www.bank.example/login', ['sid=plain; Path=/']);
    const header = jar.header(WWW);
    expect([expired, header]).toEqual(['', 'sid=plain']);
  });

  it('lets an http response replace a stored non-Secure cookie', () => {
    const jar = makeJar();
    jar.add(WWW, ['sid=old; Path=/']);
    jar.add('http://www.bank.example/login', ['sid=new; Path=/']);
    const header = jar.header(WWW);
    expect(header).toBe('sid=new');
  });

  it('treats Secure with a value or spacing as Secure', () => {
    const jar = makeJar();
    jar.add(WWW, ['s=1; Secure=true; Path=/', 't=2;  SECURE = no ; Path=/']);
    const plain = jar.header('http://www.bank.example/');
    const tls = jar.header(WWW);
    expect([plain, tls]).toEqual(['', 's=1; t=2']);
  });

  it('deletes on Max-Age=0 and on a past Expires', () => {
    const jar = makeJar();
    jar.add(WWW, ['a=1; Path=/', 'b=2; Path=/']);
    jar.add(WWW, ['a=; Max-Age=0; Path=/', 'b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/']);
    const header = jar.header(WWW);
    expect(header).toBe('');
  });

  it.each(['Max-Age = 0', 'Max-Age=600; MAX-AGE = 0', 'Expires = Thu, 01 Jan 1970 00:00:00 GMT'])(
    'deletes with a spaced expiry attribute: %s',
    attributes => {
      const jar = makeJar();
      jar.add(WWW, ['sid=active; Path=/']);
      jar.add(WWW, [`sid=expired; ${attributes}; Path=/`]);
      const header = jar.header(WWW);
      expect(header).toBe('');
    },
  );

  it('lets Max-Age win over a past Expires', () => {
    const jar = makeJar();
    jar.add(WWW, ['a=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/']);
    const header = jar.header(WWW);
    expect(header).toBe('a=1');
  });
});

describe('DomainCookieJar/session operations', () => {
  it('reads one applicable cookie value by name', () => {
    const jar = makeJar();
    jar.add(WWW, ['XSRF=t%2B1; Domain=bank.example; Path=/']);
    const hit = jar.cookieFor(MTO, 'XSRF');
    const miss = jar.cookieFor('https://evil.example/', 'XSRF');
    expect([hit, miss]).toEqual([{ has: true, value: 't%2B1' }, { has: false }]);
  });

  it('sets a client cookie host-only, path / and Secure by default', () => {
    const jar = makeJar();
    jar.set(WWW, { name: 'G3', value: 'v' });
    const exported = jar.exportAll();
    const want = stored({ name: 'G3', value: 'v' });
    expect(exported).toEqual([want]);
  });

  it('round-trips export and import with hostOnly, secure and expiry', () => {
    const source = makeJar();
    source.add(WWW, ['a=1; Domain=bank.example; Path=/; Max-Age=600', 'b=2; Path=/x']);
    const cookies = source.exportAll();
    const target = makeJar();
    target.importAll(cookies);
    const copy = target.exportAll();
    expect(copy).toEqual(cookies);
  });

  it('owns imported cookie records instead of retaining caller objects', () => {
    const input = { ...stored({ name: 'sid' }) };
    const jar = makeJar();
    jar.importAll([input]);
    input.value = 'changed; extra=1';
    input.secure = false;
    const plain = jar.header('http://www.bank.example/');
    const tls = jar.header(WWW);
    expect([plain, tls]).toEqual(['', 'sid=1']);
  });

  it('exports a detached snapshot without exposing stored cookie records', () => {
    const jar = makeJar();
    jar.set(WWW, { name: 'sid', value: '1' });
    const [exported] = jar.exportAll();
    Reflect.set(exported, 'value', 'changed; extra=1');
    Reflect.set(exported, 'secure', false);
    const plain = jar.header('http://www.bank.example/');
    const tls = jar.header(WWW);
    expect([plain, tls]).toEqual(['', 'sid=1']);
  });

  it('replaces the whole jar on import and skips expired cookies', () => {
    const jar = makeJar();
    jar.add(WWW, ['old=1; Path=/']);
    jar.importAll([stored({ name: 'new' }), stored({ name: 'gone', expiresEpochS: 1 })]);
    const header = jar.header(WWW);
    expect(header).toBe('new=1');
  });

  it('imports a domain cookie only for an allow-listed domain', () => {
    const jar = makeJar();
    const wide = stored({ name: 'wide', domain: 'example', hostOnly: false });
    const listed = stored({ name: 'listed', domain: 'bank.example', hostOnly: false });
    const host = stored({ name: 'host', domain: 'other.example' });
    jar.importAll([wide, listed, host]);
    const names = jar.exportAll().map((cookie): string => cookie.name);
    expect(names).toEqual(['listed', 'host']);
  });

  it.each([
    { label: 'a line break in the value', cookie: { name: 'a', value: 'x\ny' } },
    { label: 'a semicolon in the value', cookie: { name: 'a', value: '1; admin=1' } },
    { label: 'a character past Latin-1', cookie: { name: 'a', value: '\u05e9' } },
    { label: 'an equals sign in the name', cookie: { name: 'a=b', value: '1' } },
    { label: 'an empty name', cookie: { name: '', value: '1' } },
  ])('refuses a cookie with $label', ({ cookie }) => {
    const jar = makeJar();
    jar.set(WWW, cookie);
    jar.importAll([...jar.exportAll(), stored(cookie)]);
    const header = jar.header(WWW);
    expect(header).toBe('');
  });

  it.each([
    { label: 'an empty path', path: '' },
    { label: 'a relative path', path: 'login' },
  ])('refuses a cookie with $label', ({ path }) => {
    const jar = makeJar();
    jar.set(WWW, { name: 'a', value: '1', path });
    jar.importAll([...jar.exportAll(), stored({ path })]);
    const kept = jar.exportAll();
    const header = jar.header(WWW);
    expect([kept, header]).toEqual([[], '']);
  });

  it('empties the jar on clear', () => {
    const jar = makeJar();
    jar.add(WWW, ['a=1; Domain=bank.example; Path=/']);
    const size = jar.clear();
    const header = jar.header(MTO);
    expect([size, header]).toEqual([0, '']);
  });
});
