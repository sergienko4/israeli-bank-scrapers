/**
 * Unit tests for Strategy/Fetch/SessionCookieFetchStrategy — the opt-in
 * run-scoped, origin-scoped cookie jar in front of a node transport. A real
 * HeadlessNativeFetchStrategy sends the requests; globalThis.fetch is replaced
 * with a queue of canned responses, and the shared logger is replaced so the
 * cases can prove no cookie value is ever logged.
 */

import { jest } from '@jest/globals';

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
