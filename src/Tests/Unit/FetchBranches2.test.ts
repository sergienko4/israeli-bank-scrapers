/**
 * Additional branch coverage tests for Fetch.ts.
 * Targets: logResponseIssues (body preview, non-200, WAF), parseGetResult,
 * parsePostResult, fetchGet non-200, fetchGraphql no-errors path.
 */
import { jest } from '@jest/globals';

import {
  detectWafBlock,
  fetchGet,
  fetchGetWithinPage,
  fetchGraphql,
  fetchPost,
  fetchPostWithinPage,
} from '../../Common/Fetch.js';
import { createMockPage } from '../MockPage.js';

const MOCK_FETCH = jest.fn();
const ORIGINAL_FETCH = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = MOCK_FETCH;
});

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/**
 * Build a mock response with text method.
 * @param body - The response body string.
 * @param status - HTTP status code.
 * @returns Mock response object.
 */
function mockResponse(body: string, status = 200): { status: number; text: () => Promise<string> } {
  return {
    status,
    /**
     * Body text getter.
     * @returns The body as a promise.
     */
    text: (): Promise<string> => Promise.resolve(body),
  };
}

describe('fetchGetWithinPage — logResponseIssues branches', () => {
  it('logs body preview for non-empty response text', async () => {
    const body = JSON.stringify({ data: 'value' });
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([body, 200]) });
    const result = await fetchGetWithinPage(page, 'https://api.bank.co.il/data');
    expect(result).toEqual({ data: 'value' });
  });

  it('logs non-200 status (e.g. 500) without throwing', async () => {
    const body = JSON.stringify({ error: true });
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([body, 500]) });
    const result = await fetchGetWithinPage(page, 'https://api.bank.co.il/data');
    expect(result).toEqual({ error: true });
  });

  it('logs WAF detection for blocked response', async () => {
    const body = JSON.stringify({ blocked: true });
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([body, 429]) });
    const result = await fetchGetWithinPage(page, 'https://api.bank.co.il/data');
    expect(result).toEqual({ blocked: true });
  });

  it('handles empty response (204) without body preview log', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['', 204]) });
    const result = await fetchGetWithinPage(page, 'https://api.bank.co.il/empty');
    expect(result).toEqual({});
  });
});

describe('fetchPostWithinPage — logResponseIssues branches', () => {
  it('covers non-200 status with WAF pattern in body', async () => {
    const body = '<html>Access Denied</html>';
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([body, 503]) });
    const fetchPromise = fetchPostWithinPage(page, 'https://api.bank.co.il/data', { data: {} });
    await expect(fetchPromise).rejects.toThrow('parse');
  });

  it('covers 200 status with empty text returning empty object', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['', 200]) });
    const result = await fetchPostWithinPage(page, 'https://api.bank.co.il/data', { data: {} });
    expect(result).toEqual({});
  });
});

describe('fetchGet — non-200 throws', () => {
  beforeEach(() => MOCK_FETCH.mockReset());

  it('throws with status 404 message', async () => {
    const resp = mockResponse('Not Found', 404);
    MOCK_FETCH.mockResolvedValue(resp);
    const fetchPromise = fetchGet('https://api.bank.co.il/missing', {});
    await expect(fetchPromise).rejects.toThrow('status 404');
  });

  it('throws with status 302 message', async () => {
    const resp = mockResponse('Redirect', 302);
    MOCK_FETCH.mockResolvedValue(resp);
    const fetchPromise = fetchGet('https://api.bank.co.il/redirect', {});
    await expect(fetchPromise).rejects.toThrow('status 302');
  });
});

describe('fetchPost — extra header merging', () => {
  beforeEach(() => MOCK_FETCH.mockReset());

  it('merges extraHeaders into request', async () => {
    const resp = mockResponse('{"ok":true}');
    MOCK_FETCH.mockResolvedValue(resp);
    await fetchPost('https://api.bank.co.il/data', {}, { 'X-Token': 'abc' });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { headers: Record<string, string> }])[1];
    expect(callArgs.headers['X-Token']).toBe('abc');
  });
});

describe('fetchGraphql — no errors in response', () => {
  beforeEach(() => MOCK_FETCH.mockReset());

  it('returns data when no errors field present', async () => {
    const body = JSON.stringify({ data: { users: [] } });
    const resp = mockResponse(body);
    MOCK_FETCH.mockResolvedValue(resp);
    const result = await fetchGraphql<{ users: string[] }>('https://api.bank.co.il/gql', 'query');
    expect(result).toEqual({ users: [] });
  });

  it('returns data when errors is empty array', async () => {
    const body = JSON.stringify({ data: { items: [] }, errors: [] });
    const resp = mockResponse(body);
    MOCK_FETCH.mockResolvedValue(resp);
    const result = await fetchGraphql<{ items: string[] }>('https://api.bank.co.il/gql', 'query');
    expect(result).toEqual({ items: [] });
  });
});

describe('parseGetResult — non-Error catch branch', () => {
  it('includes non-Error message in error when JSON parse fails', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['{broken json', 200]),
    });
    const promise = fetchGetWithinPage(page, 'https://api.bank.co.il/bad');
    await expect(promise).rejects.toThrow('parse error');
  });
});

describe('parsePostResult — non-Error catch branch', () => {
  it('includes status in error when JSON parse fails with shouldIgnoreErrors false', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['{broken', 422]),
    });
    const promise = fetchPostWithinPage(page, 'https://api.bank.co.il/bad', { data: {} });
    await expect(promise).rejects.toThrow('status: 422');
  });
});

describe('detectWafBlock — additional patterns', () => {
  it('detects "access denied" in mixed case', () => {
    const result = detectWafBlock(200, '<p>ACCESS DENIED to this resource</p>');
    expect(result).toContain('access denied');
  });

  it('returns empty for 200 with non-matching HTML', () => {
    const result = detectWafBlock(200, '<html>Welcome back</html>');
    expect(result).toBe('');
  });
});
