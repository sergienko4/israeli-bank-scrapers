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

function mockJsonResponse(data: unknown, status = 200): Record<string, unknown> {
  const text = JSON.stringify(data);
  return { status, text: () => Promise.resolve(text), json: () => Promise.resolve(data) };
}

describe('fetchGet', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GET request with JSON headers', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ data: 'test' }));
    const result = await fetchGet('https://api.bank.co.il/data', {});
    expect(result).toEqual({ data: 'test' });
    expect(MOCK_FETCH).toHaveBeenCalledWith(
      'https://api.bank.co.il/data',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('merges extra headers', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({}));
    await fetchGet('https://api.bank.co.il/data', { Authorization: 'Bearer token' });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { headers: Record<string, string> }])[1];
    expect(callArgs.headers.Authorization).toBe('Bearer token');
    expect(callArgs.headers.Accept).toBe('application/json');
  });

  it('throws when status is not 200', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({}, 500));
    await expect(fetchGet('https://api.bank.co.il/data', {})).rejects.toThrow('status code 500');
  });
});

describe('fetchPost', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends POST request with JSON body', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ success: true }));
    const result = await fetchPost('https://api.bank.co.il/login', { user: 'test' });
    expect(result).toEqual({ success: true });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { method: string; body: string }])[1];
    expect(callArgs.method).toBe('POST');
    expect(callArgs.body).toBe(JSON.stringify({ user: 'test' }));
  });

  it('returns JSON even on non-200 status', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ error: true }, 500));
    const result = await fetchPost('https://api.bank.co.il/fail', {});
    expect(result).toEqual({ error: true });
  });
});

describe('fetchGraphql', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GraphQL query and returns data', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ data: { accounts: [] } }));
    const result = await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts { id } }');
    expect(result).toEqual({ accounts: [] });
  });

  it('throws when GraphQL response has errors', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ errors: [{ message: 'Unauthorized' }] }));
    await expect(fetchGraphql('https://api.bank.co.il/graphql', 'query')).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('sends variables in the request body', async () => {
    MOCK_FETCH.mockResolvedValue(mockJsonResponse({ data: {} }));
    await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts }', {
      variables: { id: '123' },
    });
    const rawBody = (MOCK_FETCH.mock.calls[0] as [string, { body: string }])[1].body;
    const body = JSON.parse(rawBody) as { variables: Record<string, unknown>; query: string };
    expect(body.variables).toEqual({ id: '123' });
    expect(body.query).toBe('{ accounts }');
  });
});

describe('fetchGetWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([JSON.stringify({ balance: 1000 }), 200]),
    });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/balance');
    expect(result).toEqual({ balance: 1000 });
  });

  it('returns null for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([null, 204]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');
    expect(result).toBeNull();
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    await expect(fetchGetWithinPage(page, 'https://bank.co.il/api/bad')).rejects.toThrow(
      'parse error',
    );
  });

  it('returns null on invalid JSON when shouldIgnoreErrors is true', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/bad', true);
    expect(result).toBeNull();
  });
});

describe('fetchPostWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([JSON.stringify({ result: 'ok' }), 200]),
    });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/action', {
      data: { key: 'value' },
    });
    expect(result).toEqual({ result: 'ok' });
  });

  it('returns null for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([null, 204]) });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', { data: {} });
    expect(result).toBeNull();
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['invalid json', 200]) });
    await expect(
      fetchPostWithinPage(page, 'https://bank.co.il/api/bad', { data: {} }),
    ).rejects.toThrow('parse error');
  });

  it('returns null on invalid JSON when shouldIgnoreErrors is true', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['invalid json', 200]) });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {
      data: {},
      shouldIgnoreErrors: true,
    });
    expect(result).toBeNull();
  });

  it('includes status in parse error message', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(['<html>blocked</html>', 403]),
    });
    await expect(
      fetchPostWithinPage(page, 'https://bank.co.il/api/blocked', { data: {} }),
    ).rejects.toThrow('status: 403');
  });

  it('passes extraHeaders to page.evaluate as single arg', async () => {
    const evaluate = jest.fn().mockResolvedValue([JSON.stringify({ ok: true }), 200]);
    const page = createMockPage({ evaluate });
    await fetchPostWithinPage(page, 'https://bank.co.il/api', {
      data: {},
      extraHeaders: { 'X-Custom': 'val' },
    });
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), {
      u: 'https://bank.co.il/api',
      d: {},
      h: { 'X-Custom': 'val' },
    });
  });
});

describe('detectWafBlock', () => {
  it('detects HTTP 403', () => {
    expect(detectWafBlock(403, null)).toBe('HTTP 403');
  });

  it('detects HTTP 429', () => {
    expect(detectWafBlock(429, null)).toBe('HTTP 429');
  });

  it('detects HTTP 503', () => {
    expect(detectWafBlock(503, null)).toBe('HTTP 503');
  });

  it('returns null for HTTP 200', () => {
    expect(detectWafBlock(200, null)).toBeNull();
  });

  it('detects "block automation" in body', () => {
    expect(detectWafBlock(200, 'Response: Block Automation detected')).toBe(
      'response contains "block automation"',
    );
  });

  it('detects "attention required" in body', () => {
    expect(detectWafBlock(200, '<title>Attention Required! | Cloudflare</title>')).toBe(
      'response contains "attention required"',
    );
  });

  it('detects "just a moment" in body', () => {
    expect(detectWafBlock(200, '<title>Just a moment...</title>')).toBe(
      'response contains "just a moment"',
    );
  });

  it('returns null for normal response body', () => {
    expect(detectWafBlock(200, '{"Header":{"Status":"1"}}')).toBeNull();
  });
});
