/**
 * Unit tests for Strategy/Fetch/SessionCookieFetchStrategy — the opt-in
 * run-scoped, origin-scoped cookie jar in front of a node transport. A real
 * HeadlessNativeFetchStrategy sends the requests; globalThis.fetch is replaced
 * with a queue of canned responses, and the shared logger is replaced so the
 * cases can prove no cookie value is ever logged.
 */

import { jest } from '@jest/globals';

import type { IManualRedirect } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

/** Single logger instance shared by the modules under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * The fetch strategies derive their logger from `import.meta.url`.
   * @returns The shared mock logger, so its calls are visible here.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's full surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const NATIVE =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js');
const SESSION =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/SessionCookieFetchStrategy.js');

type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

const BASE_URL = 'https://api.bank.example/v1/';
const LOGIN_URL = `${BASE_URL}login`;
const ITEMS_URL = `${BASE_URL}items`;
const SSO_URL = 'https://sso.other.example/done';
const SECRET = 'S3SSION-VALUE-9f2';

/** One canned response: its Set-Cookie lines and, after a redirect, its final URL. */
interface IServed {
  readonly lines: readonly string[];
  readonly url?: string;
}

/**
 * Install a fetch mock that answers each call with the next canned response.
 * A response with a `url` reports it the way fetch does after a redirect.
 * @param served - Canned responses, in call order.
 * @returns The jest mock for call-capture assertions.
 */
function serveResponses(served: readonly IServed[]): MockFetch {
  const queue = [...served];
  const mock = jest.fn<Promise<Response>, [string, RequestInit]>(() => {
    const next = queue.shift() ?? { lines: [] };
    const headers = next.lines.map((line): [string, string] => ['set-cookie', line]);
    const response = new Response('{"ok":true}', { status: 200, headers });
    if (next.url !== undefined) Object.defineProperty(response, 'url', { value: next.url });
    return Promise.resolve(response);
  });
  (globalThis as unknown as { fetch: MockFetch }).fetch = mock;
  return mock;
}

/**
 * Install a fetch mock that answers each call with the next Set-Cookie set.
 * @param cookieSets - Set-Cookie lines per response, in call order.
 * @returns The jest mock for call-capture assertions.
 */
function serveCookies(cookieSets: readonly (readonly string[])[]): MockFetch {
  const served = cookieSets.map((lines): IServed => ({ lines }));
  return serveResponses(served);
}

/**
 * Read the cookie header of one fetch call.
 * @param mock - The fetch mock.
 * @param index - Zero-based call index.
 * @returns The `cookie` header, or an empty string when none was sent.
 */
function cookieSent(mock: MockFetch, index: number): string {
  const [, init] = mock.mock.calls[index];
  const headers = init.headers as Partial<Record<string, string>>;
  return headers.cookie ?? '';
}

/**
 * Build a decorated transport over a fresh native strategy.
 * @returns The session-cookie transport.
 */
function makeTransport(): InstanceType<typeof SESSION.SessionCookieFetchStrategy> {
  const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
  return new SESSION.SessionCookieFetchStrategy(inner, BASE_URL);
}

describe('SessionCookieFetchStrategy', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the login cookies on the next GET and POST', async () => {
    const mock = serveCookies([[`sid=${SECRET}; Path=/; HttpOnly`, 'tok=1']]);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    await transport.fetchPost(ITEMS_URL, {}, { extraHeaders: {} });
    const sent = [1, 2].map((index): string => cookieSent(mock, index));
    expect(sent).toEqual([`sid=${SECRET}; tok=1`, `sid=${SECRET}; tok=1`]);
  });

  it('replaces a cookie with a later one of the same name', async () => {
    const mock = serveCookies([['sid=old'], ['sid=new']]);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const cookie = cookieSent(mock, 2);
    expect(cookie).toBe('sid=new');
  });

  it('adds no cookie header while the jar is empty and keeps caller headers', async () => {
    const mock = serveCookies([]);
    const transport = makeTransport();
    await transport.fetchGet(ITEMS_URL, { extraHeaders: { 'x-site-id': 'abc' } });
    const [, init] = mock.mock.calls[0];
    expect(init.headers).toMatchObject({ 'x-site-id': 'abc' });
    expect(init.headers).not.toHaveProperty('cookie');
  });

  it('keeps a caller cookie header while the jar is empty', async () => {
    const mock = serveCookies([]);
    const transport = makeTransport();
    await transport.fetchGet(ITEMS_URL, { extraHeaders: { Cookie: 'sid=caller' } });
    const [, init] = mock.mock.calls[0];
    expect(init.headers).toMatchObject({ Cookie: 'sid=caller' });
  });

  it.each(['Cookie', 'COOKIE', 'cookie'])(
    'replaces a caller %s header with the jar',
    async name => {
      const mock = serveCookies([[`sid=${SECRET}`]]);
      const transport = makeTransport();
      await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
      const extraHeaders = { [name]: 'sid=stale', 'x-site-id': 'abc' };
      await transport.fetchGet(ITEMS_URL, { extraHeaders });
      const wire = new Headers(mock.mock.calls[1][1].headers);
      const cookie = wire.get('cookie');
      const siteId = wire.get('x-site-id');
      expect(cookie).toBe(`sid=${SECRET}`);
      expect(siteId).toBe('abc');
    },
  );

  it("still runs the caller's own Set-Cookie hook", async () => {
    serveCookies([['sid=abc']]);
    const callerHook = jest.fn((lines: readonly string[]): number => lines.length);
    const transport = makeTransport();
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {}, onSetCookie: callerHook });
    expect(callerHook).toHaveBeenCalledWith(['sid=abc'], '');
  });

  it('files a redirected response under the origin that answered', async () => {
    const mock = serveResponses([{ lines: [`sso=${SECRET}`], url: SSO_URL }]);
    const callerHook = jest.fn((lines: readonly string[]): number => lines.length);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {}, onSetCookie: callerHook });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    await transport.fetchGet(SSO_URL, { extraHeaders: {} });
    const sent = [1, 2].map((index): string => cookieSent(mock, index));
    expect(sent).toEqual(['', `sso=${SECRET}`]);
    expect(callerHook).toHaveBeenCalledWith([`sso=${SECRET}`], SSO_URL);
  });

  it.each([
    ['another host', 'https://other.example/v1/items'],
    ['another scheme', 'http://api.bank.example/v1/items'],
    ['another port', 'https://api.bank.example:8443/v1/items'],
    ['an unparseable URL', 'https://'],
  ])('sends no cookie to %s', async (_label, foreignUrl) => {
    const mock = serveCookies([[`sid=${SECRET}`], ['foreign=1']]);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
    await transport.fetchGet(foreignUrl, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const sent = [1, 2].map((index): string => cookieSent(mock, index));
    expect(sent).toEqual(['', `sid=${SECRET}`]);
  });

  it('drops a cookie the server deletes, Max-Age winning over Expires', async () => {
    const past = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const mock = serveCookies([
      ['sid=abc', 'tok=1', 'keep=1', 'live=1'],
      ['sid=; Max-Age=0', `tok=1; Expires=${past}`, `keep=2; Max-Age=60; Expires=${past}`],
    ]);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const cookie = cookieSent(mock, 2);
    expect(cookie).toBe('keep=2; live=1');
  });

  it('never logs a cookie value', async () => {
    serveCookies([[`sid=${SECRET}`]]);
    const transport = makeTransport();
    await transport.fetchPost(LOGIN_URL, {}, { extraHeaders: {} });
    await transport.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const levels = Object.values(LOG);
    const calls = levels.flatMap((level): unknown[] => level.mock.calls);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(SECRET);
  });
});

describe('withSessionCookies', () => {
  const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);

  it.each([
    ['absent', { identityBaseUrl: BASE_URL }],
    ['false', { identityBaseUrl: BASE_URL, sessionCookies: false }],
  ])('returns the same transport when the flag is %s', (_label, args) => {
    const transport = SESSION.withSessionCookies(inner, args);
    expect(transport).toBe(inner);
  });

  it('wraps the transport when the flag is true', () => {
    const args = { identityBaseUrl: BASE_URL, sessionCookies: true };
    const transport = SESSION.withSessionCookies(inner, args);
    expect(transport).toBeInstanceOf(SESSION.SessionCookieFetchStrategy);
  });
});

const WWW_LOGIN = 'https://www.bank.example/login';
const MTO_ITEMS = 'https://mto.bank.example/items';
const DOMAIN_ARGS = {
  identityBaseUrl: BASE_URL,
  sessionCookies: true,
  cookieDomains: ['bank.example'],
};

describe('withCookieSession', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Build a domain-jar session over a fresh native strategy.
   * @returns The transport and its cookie session.
   */
  function makeSession(): ReturnType<typeof SESSION.withCookieSession> {
    const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
    return SESSION.withCookieSession(inner, DOMAIN_ARGS);
  }

  it('UT-CS-01 exposes no session and keeps the transport without the flag', () => {
    const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
    const session = SESSION.withCookieSession(inner, { identityBaseUrl: BASE_URL });
    expect(session).toEqual({ transport: inner });
  });

  it('UT-CS-02 keeps the origin jar and exposes no session without cookieDomains', () => {
    const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
    const args = { identityBaseUrl: BASE_URL, sessionCookies: true };
    const session = SESSION.withCookieSession(inner, args);
    expect(session.transport).toBeInstanceOf(SESSION.SessionCookieFetchStrategy);
    expect(session.cookies).toBeUndefined();
  });

  it('UT-CS-03 shares one jar between a login step and a scrape call', async () => {
    const mock = serveCookies([['sid=s1; Domain=bank.example; Path=/; Secure']]);
    const { transport, cookies } = makeSession();
    await transport.fetchPost(WWW_LOGIN, {}, { extraHeaders: {} });
    await transport.fetchGet(MTO_ITEMS, { extraHeaders: {} });
    const header = cookies?.headerFor(MTO_ITEMS);
    const sent = cookieSent(mock, 1);
    expect([sent, header]).toEqual(['sid=s1', { has: true, value: 'sid=s1' }]);
  });

  it('UT-CS-04 replaces the whole jar on import', async () => {
    const mock = serveCookies([['old=1; Path=/'], []]);
    const { transport, cookies } = makeSession();
    await transport.fetchPost(WWW_LOGIN, {}, { extraHeaders: {} });
    const imported = { name: 'new', value: '2', domain: 'bank.example', path: '/' };
    cookies?.importAll([{ ...imported, hostOnly: false, secure: true, expiresEpochS: 0 }]);
    await transport.fetchGet(MTO_ITEMS, { extraHeaders: {} });
    const read = cookies?.cookieFor(WWW_LOGIN, 'old');
    const sent = cookieSent(mock, 1);
    expect([sent, read]).toEqual(['new=2', { has: false }]);
  });

  it('UT-CS-05 empties the jar on clear', async () => {
    const mock = serveCookies([['sid=s1; Domain=bank.example; Path=/'], []]);
    const { transport, cookies } = makeSession();
    await transport.fetchPost(WWW_LOGIN, {}, { extraHeaders: {} });
    const size = cookies?.clear();
    await transport.fetchGet(MTO_ITEMS, { extraHeaders: {} });
    const header = cookies?.headerFor(MTO_ITEMS);
    const sent = cookieSent(mock, 1);
    expect([size, sent, header]).toEqual([0, '', { has: false }]);
  });
});

const MTO_LANDING = 'https://mto.bank.example/Online/Default.aspx';
const TO_MTO: IManualRedirect = {
  maxHops: 1,
  allow: [{ origin: 'https://mto.bank.example', paths: ['/Online/Default.aspx'] }],
};

describe('withCookieSession across manual redirect hops', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Serve a www seed answer, then a www 302 to MTO, then the MTO page.
   * @returns The jest mock for call-capture assertions.
   */
  function serveLogin(): MockFetch {
    const seedCookies = ['wwwonly=1; Path=/', 'shared=1; Domain=bank.example; Path=/'];
    const seedHeaders = seedCookies.map((line): [string, string] => ['set-cookie', line]);
    const hopHeaders: [string, string][] = [
      ['location', MTO_LANDING],
      ['set-cookie', 'hop1=1; Domain=bank.example; Path=/'],
    ];
    const queue = [
      new Response('{}', { status: 200, headers: seedHeaders }),
      new Response(null, { status: 302, headers: hopHeaders }),
      new Response('{}', { status: 200 }),
    ];
    const mock = jest.fn<Promise<Response>, [string, RequestInit]>(() => {
      const next = queue.shift() ?? new Response('{}', { status: 200 });
      return Promise.resolve(next);
    });
    (globalThis as unknown as { fetch: MockFetch }).fetch = mock;
    return mock;
  }

  it('UT-RD-12 sends hop cookies and domain cookies on, never a host-only cookie of www', async () => {
    const mock = serveLogin();
    const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
    const { transport } = SESSION.withCookieSession(inner, DOMAIN_ARGS);
    await transport.fetchGet(WWW_LOGIN, { extraHeaders: {} });
    const result = await transport.fetchGet(`${WWW_LOGIN}/go`, {
      extraHeaders: {},
      redirect: TO_MTO,
    });
    expect(result.success).toBe(true);
    expect(mock.mock.calls[2][0]).toBe(MTO_LANDING);
    const loginCookies = cookieSent(mock, 1);
    const hopCookies = cookieSent(mock, 2);
    expect(loginCookies).toBe('wwwonly=1; shared=1');
    expect(hopCookies).toBe('shared=1; hop1=1');
  });

  it('UT-RD-13 resolves each sentinel for the hop URL, never carrying a www-only value to mto', async () => {
    const mock = serveLogin();
    const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
    const { transport } = SESSION.withCookieSession(inner, DOMAIN_ARGS);
    await transport.fetchGet(WWW_LOGIN, { extraHeaders: {} });
    const extraHeaders = { 'X-Www': '@cookie:wwwonly', 'X-Hop': '@cookie:hop1' };
    await transport.fetchGet(`${WWW_LOGIN}/go`, { extraHeaders, redirect: TO_MTO });
    const sent = [1, 2].map((call): Headers => new Headers(mock.mock.calls[call][1].headers));
    const echoed = sent.map((headers): (string | null)[] => [
      headers.get('x-www'),
      headers.get('x-hop'),
    ]);
    expect(echoed).toEqual([
      ['1', null],
      [null, '1'],
    ]);
  });
});

const DROPPED = '(dropped)';
const WWW_ONLY = 'XSRF-TOKEN=www; Path=/';
const DEEP = 'XSRF-TOKEN=deep; Domain=bank.example; Path=/secure';
const MTO_SECURE = 'https://mto.bank.example/secure/x';
const XSRF_SENTINEL = { 'X-XSRF-TOKEN': '@cookie:XSRF-TOKEN', accept: 'application/json' };

/**
 * Read every header of one fetch call.
 * @param mock - The fetch mock.
 * @param index - Zero-based call index.
 * @returns The headers that call sent.
 */
function headersSent(mock: MockFetch, index: number): Readonly<Record<string, string>> {
  const [, init] = mock.mock.calls[index];
  return init.headers as Record<string, string>;
}

/**
 * Seed a domain-jar session from one www answer, then send one GET carrying
 * the XSRF sentinel.
 * @param seed - Set-Cookie lines of the www answer.
 * @param url - URL of the GET that carries the sentinel.
 * @returns The headers the GET sent.
 */
async function sendSentinel(
  seed: readonly string[],
  url: string,
): Promise<Readonly<Record<string, string>>> {
  const mock = serveCookies([seed, []]);
  const inner = new NATIVE.HeadlessNativeFetchStrategy(BASE_URL);
  const { transport } = SESSION.withCookieSession(inner, DOMAIN_ARGS);
  await transport.fetchPost(WWW_LOGIN, {}, { extraHeaders: {} });
  await transport.fetchGet(url, { extraHeaders: XSRF_SENTINEL });
  return headersSent(mock, 1);
}

describe('withCookieSession resolving @cookie: sentinels', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('UT-SN-01 sends an encoded cookie decoded and keeps the other headers', async () => {
    const seed = ['XSRF-TOKEN=a%2Bb%3D%3D; Domain=bank.example; Path=/'];
    const sent = await sendSentinel(seed, MTO_ITEMS);
    expect(sent['X-XSRF-TOKEN']).toBe('a+b==');
    expect(sent.accept).toBe('application/json');
    expect(sent.cookie).toBe('XSRF-TOKEN=a%2Bb%3D%3D');
  });

  it('UT-SN-02 drops the header when the cookie is missing', async () => {
    const sent = await sendSentinel(['other=1; Domain=bank.example; Path=/'], MTO_ITEMS);
    expect(sent).not.toHaveProperty('X-XSRF-TOKEN');
    expect(sent.accept).toBe('application/json');
  });

  it('UT-SN-03 sends a malformed escape raw', async () => {
    const sent = await sendSentinel(
      ['XSRF-TOKEN=%E0%A4%A; Domain=bank.example; Path=/'],
      MTO_ITEMS,
    );
    expect(sent['X-XSRF-TOKEN']).toBe('%E0%A4%A');
  });

  it.each([
    { label: 'a line break', raw: 'a%0Ab' },
    { label: 'a NUL', raw: 'a%00b' },
    { label: 'a character past Latin-1', raw: '%D7%A9' },
  ])('UT-SN-05 sends a value that decodes to $label raw', async ({ raw }) => {
    const sent = await sendSentinel([`XSRF-TOKEN=${raw}; Domain=bank.example; Path=/`], MTO_ITEMS);
    expect(sent['X-XSRF-TOKEN']).toBe(raw);
  });

  it.each([
    { label: 'a host-only cookie of www on mto', line: WWW_ONLY, url: MTO_ITEMS, want: DROPPED },
    { label: 'a path-scoped cookie outside its path', line: DEEP, url: MTO_ITEMS, want: DROPPED },
    { label: 'a path-scoped cookie inside its path', line: DEEP, url: MTO_SECURE, want: 'deep' },
  ])('UT-SN-04 respects path and domain: $label', async ({ line, url, want }) => {
    const sent = await sendSentinel([line], url);
    const xsrf = Object.hasOwn(sent, 'X-XSRF-TOKEN') ? sent['X-XSRF-TOKEN'] : DROPPED;
    expect(xsrf).toBe(want);
  });
});
