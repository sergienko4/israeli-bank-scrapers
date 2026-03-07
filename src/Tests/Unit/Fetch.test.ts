import {
  detectWafBlock,
  fetchGet,
  fetchGetWithinPage,
  fetchGraphql,
  fetchPost,
  fetchPostWithinPage,
} from '../../Common/Fetch';
import { createMockPage } from '../MockPage';

const MOCK_FETCH = jest.fn();
const ORIGINAL_FETCH = global.fetch;

beforeAll(() => {
  global.fetch = MOCK_FETCH;
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

interface IMockResponse {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<object>;
}

/**
 * Creates a mock fetch response object returning the given data as JSON.
 *
 * @param data - the data to include in the mock response
 * @param status - the HTTP status code for the response (default: 200)
 * @returns a mock response object with status, text, and json methods
 */
function mockJsonResponse(data: object, status = 200): IMockResponse {
  const text = JSON.stringify(data);
  return {
    status,
    /**
     * Returns the response body as text.
     *
     * @returns a promise resolving to the serialized JSON text
     */
    text: () => Promise.resolve(text),
    /**
     * Returns the response body as parsed JSON.
     *
     * @returns a promise resolving to the parsed data object
     */
    json: () => Promise.resolve(data),
  };
}

describe('fetchGet', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GET request with JSON headers', async () => {
    const mockResp = mockJsonResponse({ data: 'test' });
    MOCK_FETCH.mockResolvedValue(mockResp);
    const result = await fetchGet('https://api.bank.co.il/data', {});
    expect(result).toEqual({ data: 'test' });
    const getMatcher = expect.objectContaining({ method: 'GET' }) as object;
    expect(MOCK_FETCH).toHaveBeenCalledWith('https://api.bank.co.il/data', getMatcher);
  });

  it('merges extra headers', async () => {
    const mockResp = mockJsonResponse({});
    MOCK_FETCH.mockResolvedValue(mockResp);
    await fetchGet('https://api.bank.co.il/data', { Authorization: 'Bearer token' });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { headers: Record<string, string> }])[1];
    expect(callArgs.headers.Authorization).toBe('Bearer token');
    expect(callArgs.headers.Accept).toBe('application/json');
  });

  it('throws when status is not 200', async () => {
    const mockResp = mockJsonResponse({}, 500);
    MOCK_FETCH.mockResolvedValue(mockResp);
    const getPromise = fetchGet('https://api.bank.co.il/data', {});
    await expect(getPromise).rejects.toThrow('status 500');
  });
});

describe('fetchPost', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends POST request with JSON body', async () => {
    const mockResp = mockJsonResponse({ success: true });
    MOCK_FETCH.mockResolvedValue(mockResp);
    const result = await fetchPost('https://api.bank.co.il/login', { user: 'test' });
    expect(result).toEqual({ success: true });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { method: string; body: string }])[1];
    expect(callArgs.method).toBe('POST');
    const expectedBody = JSON.stringify({ user: 'test' });
    expect(callArgs.body).toBe(expectedBody);
  });

  it('returns JSON even on non-200 status', async () => {
    const mockResp = mockJsonResponse({ error: true }, 500);
    MOCK_FETCH.mockResolvedValue(mockResp);
    const result = await fetchPost('https://api.bank.co.il/fail', {});
    expect(result).toEqual({ error: true });
  });
});

describe('fetchGraphql', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GraphQL query and returns data', async () => {
    const mockResp = mockJsonResponse({ data: { accounts: [] } });
    MOCK_FETCH.mockResolvedValue(mockResp);
    const result = await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts { id } }');
    expect(result).toEqual({ accounts: [] });
  });

  it('throws when GraphQL response has errors', async () => {
    const mockResp = mockJsonResponse({ errors: [{ message: 'Unauthorized' }] });
    MOCK_FETCH.mockResolvedValue(mockResp);
    const gqlPromise = fetchGraphql('https://api.bank.co.il/graphql', 'query');
    await expect(gqlPromise).rejects.toThrow('Unauthorized');
  });

  it('sends variables in the request body', async () => {
    const mockResp = mockJsonResponse({ data: {} });
    MOCK_FETCH.mockResolvedValue(mockResp);
    await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts }', {
      variables: { id: '123' },
    });
    const rawBody = (MOCK_FETCH.mock.calls[0] as [string, { body: string }])[1].body;
    const body = JSON.parse(rawBody) as { variables: Record<string, string>; query: string };
    expect(body.variables).toEqual({ id: '123' });
    expect(body.query).toBe('{ accounts }');
  });
});

describe('fetchGetWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({
      evaluate: jest
        .fn()
        .mockResolvedValue({ ok: true, text: JSON.stringify({ balance: 1000 }), status: 200 }),
    });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/balance');
    expect(result).toEqual({ isFound: true, value: { balance: 1000 } });
  });

  it('returns isFound:false for 204 status', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: null, status: 204 }),
    });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');
    expect(result).toEqual({ isFound: false });
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: 'not json', status: 200 }),
    });
    const getPromise = fetchGetWithinPage(page, 'https://bank.co.il/api/bad');
    await expect(getPromise).rejects.toThrow('parse error');
  });

  it('returns isFound:false on invalid JSON when shouldIgnoreErrors is true', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: 'not json', status: 200 }),
    });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/bad', true);
    expect(result).toEqual({ isFound: false });
  });

  it('throws when evaluate returns ok:false (fetch network error)', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: false, err: 'network error', status: 0 }),
    });
    const failPromise = fetchGetWithinPage(page, 'https://bank.co.il/api/fail');
    await expect(failPromise).rejects.toThrow('fetchGetWithinPage error');
  });
});

describe('fetchPostWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({
      evaluate: jest
        .fn()
        .mockResolvedValue({ ok: true, text: JSON.stringify({ result: 'ok' }), status: 200 }),
    });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/action', {
      data: { key: 'value' },
    });
    expect(result).toEqual({ isFound: true, value: { result: 'ok' } });
  });

  it('returns isFound:false for 204 status', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: null, status: 204 }),
    });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', { data: {} });
    expect(result).toEqual({ isFound: false });
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: 'invalid json', status: 200 }),
    });
    const postPromise = fetchPostWithinPage(page, 'https://bank.co.il/api/bad', { data: {} });
    await expect(postPromise).rejects.toThrow('parse error');
  });

  it('returns isFound:false on invalid JSON when shouldIgnoreErrors is true', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue({ ok: true, text: 'invalid json', status: 200 }),
    });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {
      data: {},
      shouldIgnoreErrors: true,
    });
    expect(result).toEqual({ isFound: false });
  });

  it('includes status in parse error message', async () => {
    const page = createMockPage({
      evaluate: jest
        .fn()
        .mockResolvedValue({ ok: true, text: '<html>blocked</html>', status: 403 }),
    });
    const blockedPromise = fetchPostWithinPage(page, 'https://bank.co.il/api/blocked', {
      data: {},
    });
    await expect(blockedPromise).rejects.toThrow('status: 403');
  });

  it('throws when evaluate returns ok:false (post network error)', async () => {
    const page = createMockPage({
      evaluate: jest
        .fn()
        .mockResolvedValue({ ok: false, text: null, status: 0, err: 'post failed' }),
    });
    const failPromise = fetchPostWithinPage(page, 'https://bank.co.il/api/fail', { data: {} });
    await expect(failPromise).rejects.toThrow('fetchPostWithinPage error');
  });

  it('passes extraHeaders to page.evaluate as single arg', async () => {
    const evaluate = jest
      .fn()
      .mockResolvedValue({ ok: true, text: JSON.stringify({ ok: true }), status: 200 });
    const page = createMockPage({ evaluate });
    await fetchPostWithinPage(page, 'https://bank.co.il/api', {
      data: {},
      extraHeaders: { 'X-Custom': 'val' },
    });
    const anyFn = expect.any(Function) as unknown;
    expect(evaluate).toHaveBeenCalledWith(anyFn, {
      url: 'https://bank.co.il/api',
      body: '{}',
      headers: { 'X-Custom': 'val' },
    });
  });
});

describe('detectWafBlock', () => {
  it('detects HTTP 403', () => {
    const result = detectWafBlock(403, '');
    expect(result).toBe('HTTP 403');
  });

  it('detects HTTP 429', () => {
    const result = detectWafBlock(429, '');
    expect(result).toBe('HTTP 429');
  });

  it('detects HTTP 503', () => {
    const result = detectWafBlock(503, '');
    expect(result).toBe('HTTP 503');
  });

  it('returns empty string for HTTP 200', () => {
    const result = detectWafBlock(200, '');
    expect(result).toBe('');
  });

  it('detects "block automation" in body', () => {
    const result = detectWafBlock(200, 'Response: Block Automation detected');
    expect(result).toBe('response contains "block automation"');
  });

  it('detects "attention required" in body', () => {
    const result = detectWafBlock(200, '<title>Attention Required! | Cloudflare</title>');
    expect(result).toBe('response contains "attention required"');
  });

  it('detects "just a moment" in body', () => {
    const result = detectWafBlock(200, '<title>Just a moment...</title>');
    expect(result).toBe('response contains "just a moment"');
  });

  it('returns empty string for normal response body', () => {
    const result = detectWafBlock(200, '{"Header":{"Status":"1"}}');
    expect(result).toBe('');
  });
});
