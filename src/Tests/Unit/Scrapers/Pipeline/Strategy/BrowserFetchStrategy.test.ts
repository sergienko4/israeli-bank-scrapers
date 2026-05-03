/**
 * Unit tests for BrowserFetchStrategy.ts.
 * Mocks fetchPostWithinPage and fetchGetWithinPage to test all paths.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js', () => ({
  fetchPostWithinPage: jest.fn(),
  fetchGetWithinPage: jest.fn(),
  fetchGetWithinPageWithHeaders: jest.fn(),
}));

const FETCH_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js');
const STRATEGY_MOD =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js');
const { makeMockFullPage: MAKE_MOCK_FULL_PAGE } = await import('../MockPipelineFactories.js');

const { DEFAULT_FETCH_OPTS } =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js');

const OPTS_NO_HEADERS = DEFAULT_FETCH_OPTS;
const OPTS_WITH_HEADERS = { extraHeaders: { Authorization: 'Bearer tok' } };

beforeEach(() => {
  (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockReset();
  (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockReset();
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

/** Page or frame URL string. */
type FrameUrl = string;

/** Frame fixture passed to makePageWithFrames. */
interface IFrameFixture {
  readonly url: FrameUrl;
}

/** Frame stub exposing only .url() (used by resolveContext). */
interface IFrameStub {
  url: () => FrameUrl;
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
  const stubUrlGetter = (fxUrl: FrameUrl): (() => FrameUrl) => {
    /**
     * Frame URL getter — captures the fixture URL.
     * @returns The captured fixture URL.
     */
    const getter = (): FrameUrl => fxUrl;
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
  const urlFn = (): FrameUrl => pageUrl;
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
