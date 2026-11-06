/**
 * Unit tests for BrowserFetchStrategy.ts.
 * Mocks fetchPostWithinPage and fetchGetWithinPage to test all paths.
 */

import { jest } from '@jest/globals';

import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js',
  () => ({
    fetchPostWithinPage: jest.fn(),
    fetchGetWithinPage: jest.fn(),
    fetchGetWithinPageWithHeaders: jest.fn(),
  }),
);

const FETCH_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js');
const STRATEGY_MOD =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js');
const { makeMockFullPage: MAKE_MOCK_FULL_PAGE } = await import('../MockPipelineFactories.js');

const { DEFAULT_FETCH_OPTS } =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js');

const { TimeoutError: TIMEOUT_ERROR } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Timing/TimingActions.js');
const { ScraperErrorTypes: ERROR_TYPES } =
  await import('../../../../../Scrapers/Base/ErrorTypes.js');
const { WafBlockError: WAF_BLOCK_ERROR } = await import('../../../../../Scrapers/Base/Errors.js');
const { COOKIE_HEADER_SENTINEL_PREFIX } =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/CookieHeaderSentinel.js');

const OPTS_NO_HEADERS = DEFAULT_FETCH_OPTS;
const OPTS_WITH_HEADERS = { extraHeaders: { Authorization: 'Bearer tok' } };

beforeEach(() => {
  (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockReset();
  (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockReset();
  (FETCH_MOD.fetchGetWithinPageWithHeaders as jest.Mock).mockReset();
});

// ── fetchPost ─────────────────────────────────────────────

describe('BrowserFetchStrategy/fetchPost', () => {
  it('returns succeed with data when fetchPostWithinPage returns data', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ result: 'ok' });
    const page = MAKE_MOCK_FULL_PAGE();
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual({ result: 'ok' });
  });

  it('returns fail when fetchPostWithinPage returns null (empty response)', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue(null);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('empty response');
  });

  it('returns fail when fetchPostWithinPage returns undefined', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue(undefined);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
  });

  it('returns fail with error message when fetchPostWithinPage throws', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockRejectedValue(new Error('network error'));
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('network error');
  });

  it('classifies an expired fetch deadline as Timeout, not Generic', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockRejectedValue(new TIMEOUT_ERROR('deadline exceeded'));
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ERROR_TYPES.Timeout);
  });

  it('leaves an unmarked failure classified as Generic', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockRejectedValue(new Error('connection reset'));
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ERROR_TYPES.Generic);
  });

  // WafBlocked is terminal in ApiMediator.retry.ts. Flattening it to Generic
  // would let a re-mint fire against an edge that never saw the API, so the
  // classification has to survive the Procedure boundary.
  it('classifies a WAF bounce as WafBlocked, not Generic', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    const blocked = WAF_BLOCK_ERROR.apiBlock(200, 'https://api.test/post');
    postFn.mockRejectedValue(blocked);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ERROR_TYPES.WafBlocked);
  });

  // `toLegacy` forwards `errorDetails` onto the public result, so dropping it
  // here would strip the redacted URL and body snippet that this whole path
  // exists to surface — the caller would get the right type and no evidence.
  it('carries the structured WAF details onto the failure', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    const blocked = WAF_BLOCK_ERROR.apiBlock(200, 'https://api.test/post');
    postFn.mockRejectedValue(blocked);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorDetails.has).toBe(true);
  });

  it('keeps the blocked page URL in the forwarded details', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    const blocked = WAF_BLOCK_ERROR.apiBlock(200, 'https://api.test/post');
    postFn.mockRejectedValue(blocked);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    const details = result.success ? undefined : result.errorDetails;
    expect(details?.has === true ? details.value.pageUrl : '').toBe('https://api.test/post');
  });

  it('truncates long URL in empty response error at 80 chars', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue(null);
    const longUrl = 'https://api.test/' + 'a'.repeat(100);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchPost(longUrl, {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage.length).toBeLessThan(150);
    }
  });
});

// ── fetchGet ──────────────────────────────────────────────

describe('BrowserFetchStrategy/fetchGet', () => {
  it('returns succeed with data when fetchGetWithinPage returns data', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockResolvedValue({ accounts: [] });
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchGet('https://api.test/get', OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual({ accounts: [] });
  });

  it('returns fail when fetchGetWithinPage returns null', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockResolvedValue(null);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchGet('https://api.test/get', OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('empty response');
  });

  it('returns fail with error message when fetchGetWithinPage throws', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockRejectedValue(new Error('get failed'));
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchGet('https://api.test/get', OPTS_NO_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('get failed');
  });

  it('uses fetchGetWithinPageWithHeaders when extraHeaders are present', async () => {
    const getHeadersFn = FETCH_MOD.fetchGetWithinPageWithHeaders as jest.Mock;
    getHeadersFn.mockResolvedValue({ data: 'ok' });
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchGet('https://api.test/get', OPTS_WITH_HEADERS);
    expect(result.success).toBe(true);
    expect(getHeadersFn).toHaveBeenCalled();
  });

  it('calls fetchGetWithinPage with shouldIgnoreErrors=false when no extraHeaders', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockResolvedValue({ data: 'ok' });
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    await strategy.fetchGet('https://api.test/get', OPTS_NO_HEADERS);
    expect(getFn).toHaveBeenCalled();
    const lastCallArgs = getFn.mock.calls[0] as [unknown, string, boolean];
    expect(lastCallArgs[2]).toBe(false);
  });
});

// ── resolveContext (cross-origin frame resolution) ────────

/** Frame fixture passed to makePageWithFrames. */
interface IFrameFixture {
  readonly url: string;
}

/** Frame stub exposing only .url() (used by resolveContext). */
interface IFrameStub {
  url: () => string;
}

/** Page mock type — re-exports playwright Page from MAKE_MOCK_FULL_PAGE. */
type MockPage = ReturnType<typeof MAKE_MOCK_FULL_PAGE>;

/**
 * Build a Page mock with controlled .url() and .frames() so we can
 * exercise BrowserFetchStrategy.resolveContext branches.
 * @param pageUrl - Page-level URL the mock returns from .url().
 * @param frames - Frame URLs returned from .frames() — one stub per entry.
 * @returns Mock Page bound to those overrides.
 */
function makePageWithFrames(pageUrl: string, frames: readonly IFrameFixture[]): MockPage {
  const base = MAKE_MOCK_FULL_PAGE(pageUrl);
  /**
   * Stub url() — returns the captured fixture url.
   * @param fxUrl - Fixture URL.
   * @returns URL getter that returns the captured fixture URL.
   */
  const stubUrlGetter = (fxUrl: string): (() => string) => {
    /**
     * Frame URL getter — captures the fixture URL.
     * @returns The captured fixture URL.
     */
    const getter = (): string => fxUrl;
    return getter;
  };
  /**
   * Convert a fixture to a frame stub returning its url().
   * @param f - Fixture record.
   * @returns Frame stub.
   */
  const toStub = (f: IFrameFixture): IFrameStub => ({ url: stubUrlGetter(f.url) });
  /**
   * Return a fresh array of frame stubs each call.
   * @returns Frame stubs.
   */
  const framesFn = (): IFrameStub[] => frames.map(toStub);
  /**
   * Page URL getter override.
   * @returns Configured pageUrl.
   */
  const urlFn = (): string => pageUrl;
  return { ...base, url: urlFn, frames: framesFn } as MockPage;
}

describe('BrowserFetchStrategy/resolveContext via fetchPost', () => {
  it('uses page when target origin matches page origin (same-origin shortcut)', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ ok: true });
    const page = makePageWithFrames('https://bank.example.com', []);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost(
      'https://bank.example.com/api/get',
      {},
      OPTS_NO_HEADERS,
    );
    expect(result.success).toBe(true);
  });

  it('uses page when no frame matches target origin (no-frame fallback)', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ ok: true });
    const page = makePageWithFrames('https://bank.example.com', [
      { url: 'https://other.example.com/page' },
    ]);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
  });

  it('skips empty-url frames in cross-origin lookup', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ ok: true });
    const page = makePageWithFrames('https://bank.example.com', [{ url: '' }]);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
  });

  it('skips about:blank frames in cross-origin lookup', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ ok: true });
    const page = makePageWithFrames('https://bank.example.com', [{ url: 'about:blank' }]);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
  });

  it('uses matching iframe when its origin matches target origin', async () => {
    const postFn = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    postFn.mockResolvedValue({ ok: true });
    const page = makePageWithFrames('https://bank.example.com', [
      { url: 'https://api.test/iframe' },
    ]);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', {}, OPTS_NO_HEADERS);
    expect(result.success).toBe(true);
    expect(postFn).toHaveBeenCalled();
  });
});

// ── fetchGet @cookie: sentinels (resolved like fetchPost) ─

const GET_URL = 'https://api.test/get';
const ACCEPT = { Accept: 'application/json' } as const;
const XSRF_SENTINEL = `${COOKIE_HEADER_SENTINEL_PREFIX}XSRF-TOKEN`;
const XSRF_COOKIE = { name: 'XSRF-TOKEN', value: 'tok' } as const;

/** One cookie the page context hands back. */
interface IJarCookie {
  readonly name: string;
  readonly value: string;
}

/**
 * Build a page whose browser context hands back a stubbed cookie jar.
 * @param cookiesFn - Stub for `context().cookies(url)`.
 * @returns Mock page on GET_URL's origin bound to that context.
 */
function makePageWithJar(cookiesFn: jest.Mock): MockPage {
  const base = MAKE_MOCK_FULL_PAGE(GET_URL);
  /**
   * Browser-context stub exposing only `cookies()`.
   * @returns Context holding the cookies stub.
   */
  const contextFn = (): { cookies: jest.Mock } => ({ cookies: cookiesFn });
  return { ...base, context: contextFn } as unknown as MockPage;
}

/**
 * Run one browser GET whose headers carry the XSRF sentinel.
 * @param jar - Cookies the page context hands back.
 * @param headers - Outgoing header map, sentinels unresolved.
 * @returns The page, the cookies stub and the GET's success flag.
 */
async function getWithJar(
  jar: readonly IJarCookie[],
  headers: Record<string, string>,
): Promise<{ page: MockPage; cookiesFn: jest.Mock; isOk: boolean }> {
  const cookiesFn = jest.fn().mockResolvedValue(jar);
  const page = makePageWithJar(cookiesFn);
  const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
  const result = await strategy.fetchGet(GET_URL, { extraHeaders: headers });
  return { page, cookiesFn, isOk: result.success };
}

describe('BrowserFetchStrategy/fetchGet — @cookie: sentinels', () => {
  it.each([
    ['sends the named cookie value', [XSRF_COOKIE], { ...ACCEPT, 'X-XSRF-TOKEN': 'tok' }],
    ['drops the header when the cookie is absent', [], ACCEPT],
  ] as const)('%s', async (_title, jar, sent) => {
    const getHeadersFn = FETCH_MOD.fetchGetWithinPageWithHeaders as jest.Mock;
    getHeadersFn.mockResolvedValue({ data: 'ok' });
    const headers = { ...ACCEPT, 'X-XSRF-TOKEN': XSRF_SENTINEL };
    const run = await getWithJar(jar, headers);
    expect(run.isOk).toBe(true);
    expect(getHeadersFn).toHaveBeenCalledWith(run.page, GET_URL, sent);
  });

  it('reads only the request URL cookies', async () => {
    (FETCH_MOD.fetchGetWithinPageWithHeaders as jest.Mock).mockResolvedValue({ data: 'ok' });
    const run = await getWithJar([XSRF_COOKIE], { 'X-XSRF-TOKEN': XSRF_SENTINEL });
    expect(run.cookiesFn).toHaveBeenCalledWith(GET_URL);
  });

  it('takes the plain GET when every header drops', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockResolvedValue({ data: 'ok' });
    const run = await getWithJar([], { 'X-XSRF-TOKEN': XSRF_SENTINEL });
    expect(getFn).toHaveBeenCalledWith(run.page, GET_URL, false);
    expect(FETCH_MOD.fetchGetWithinPageWithHeaders).not.toHaveBeenCalled();
  });
});

// ── @cookie-strict: sentinels (strict decode on both verbs) ─

const STRICT_XSRF = { 'X-XSRF-TOKEN': '@cookie-strict:XSRF-TOKEN' } as const;
const MALFORMED_XSRF = { name: 'XSRF-TOKEN', value: '%E0%A4%A' } as const;
const UNDECODABLE = { success: false, errorMessage: 'cookie XSRF-TOKEN undecodable' } as const;

describe('BrowserFetchStrategy — @cookie-strict: sentinels', () => {
  it('sends a strict cookie decoded on GET', async () => {
    const getHeadersFn = FETCH_MOD.fetchGetWithinPageWithHeaders as jest.Mock;
    getHeadersFn.mockResolvedValue({ data: 'ok' });
    const jar = [{ name: 'XSRF-TOKEN', value: 'a%2Bb%3D%3D' }];
    const run = await getWithJar(jar, STRICT_XSRF);
    expect(getHeadersFn).toHaveBeenCalledWith(run.page, GET_URL, { 'X-XSRF-TOKEN': 'a+b==' });
  });

  it('stops a GET on an undecodable cookie before the page fetch', async () => {
    const run = await getWithJar([MALFORMED_XSRF], STRICT_XSRF);
    expect(run.isOk).toBe(false);
    expect(FETCH_MOD.fetchGetWithinPage).not.toHaveBeenCalled();
    expect(FETCH_MOD.fetchGetWithinPageWithHeaders).not.toHaveBeenCalled();
  });

  it('stops a POST on an undecodable cookie before the page fetch', async () => {
    const cookiesFn = jest.fn().mockResolvedValue([MALFORMED_XSRF]);
    const page = makePageWithJar(cookiesFn);
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
    const result = await strategy.fetchPost(GET_URL, {}, { extraHeaders: STRICT_XSRF });
    expect(result).toMatchObject(UNDECODABLE);
    expect(FETCH_MOD.fetchPostWithinPage).not.toHaveBeenCalled();
  });
});

const CLOSED = 'Target page, context or browser has been closed';
const CLOSED_FAILURE = {
  success: false,
  errorType: ERROR_TYPES.Generic,
  errorMessage: CLOSED,
} as const;

/**
 * Run a sentinel-bearing request whose cookie lookup rejects.
 * @param verb - Request method.
 * @returns The request's structured result.
 */
async function runWithBrokenJar(verb: 'GET' | 'POST'): Promise<Procedure<unknown>> {
  const cookiesFn = jest.fn<Promise<IJarCookie[]>, []>().mockRejectedValue(new Error(CLOSED));
  const page = makePageWithJar(cookiesFn);
  const strategy = new STRATEGY_MOD.BrowserFetchStrategy(page);
  const opts = { extraHeaders: STRICT_XSRF };
  if (verb === 'GET') return strategy.fetchGet(GET_URL, opts);
  return strategy.fetchPost(GET_URL, {}, opts);
}

describe('BrowserFetchStrategy — cookie lookup failure', () => {
  it.each(['GET', 'POST'] as const)('fails a %s before the page fetch', async verb => {
    const result = await runWithBrokenJar(verb);
    expect(result).toMatchObject(CLOSED_FAILURE);
    expect(FETCH_MOD.fetchPostWithinPage).not.toHaveBeenCalled();
    expect(FETCH_MOD.fetchGetWithinPage).not.toHaveBeenCalled();
    expect(FETCH_MOD.fetchGetWithinPageWithHeaders).not.toHaveBeenCalled();
  });
});
