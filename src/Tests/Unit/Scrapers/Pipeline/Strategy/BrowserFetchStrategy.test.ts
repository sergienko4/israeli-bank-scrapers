/**
 * Unit tests for BrowserFetchStrategy.ts.
 * Mocks fetchPostWithinPage and fetchGetWithinPage to test all paths.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../../../Common/Fetch.js', () => ({
  fetchPostWithinPage: jest.fn(),
  fetchGetWithinPage: jest.fn(),
}));

const FETCH_MOD = await import('../../../../../Common/Fetch.js');
const STRATEGY_MOD =
  await import('../../../../../Scrapers/Pipeline/Strategy/BrowserFetchStrategy.js');
const { makeMockFullPage: MAKE_MOCK_FULL_PAGE } = await import('../MockPipelineFactories.js');

const { DEFAULT_FETCH_OPTS } =
  await import('../../../../../Scrapers/Pipeline/Strategy/FetchStrategy.js');

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

  it('fails fast when extraHeaders are present (not yet supported)', async () => {
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    const result = await strategy.fetchGet('https://api.test/get', OPTS_WITH_HEADERS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not yet supported');
  });

  it('calls fetchGetWithinPage with shouldIgnoreErrors=false when no extraHeaders', async () => {
    const getFn = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    getFn.mockResolvedValue({ data: 'ok' });
    const strategy = new STRATEGY_MOD.BrowserFetchStrategy(MAKE_MOCK_FULL_PAGE());
    await strategy.fetchGet('https://api.test/get', OPTS_NO_HEADERS);
    expect(getFn).toHaveBeenCalled();
    const lastCallArgs = (getFn as unknown as jest.Mock).mock.calls[0] as [
      unknown,
      string,
      boolean,
    ];
    expect(lastCallArgs[2]).toBe(false);
  });
});
