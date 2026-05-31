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

interface IMockResponse {
  status: number;
  text: () => Promise<string>;
  json: () => Promise<Record<string, string | number | boolean | object>>;
}

/**
 * Creates a mock JSON response for fetch.
 * @param data - The response data payload.
 * @param status - The HTTP status code.
 * @returns A mock response object with text and json methods.
 */
function mockJsonResponse(
  data: Record<string, string | number | boolean | object>,
  status = 200,
): IMockResponse {
  const text = JSON.stringify(data);
  /**
   * Resolves with the stringified response text.
   * @returns The text promise.
   */
  const textFn = (): Promise<string> => Promise.resolve(text);
  /**
   * Resolves with the parsed response data.
   * @returns The data promise.
   */
  const jsonFn = (): Promise<Record<string, string | number | boolean | object>> =>
    Promise.resolve(data);
  return { status, text: textFn, json: jsonFn };
}

describe('fetchGet', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GET request with JSON headers', async () => {
    const response = mockJsonResponse({ data: 'test' });
    MOCK_FETCH.mockResolvedValue(response);
    const result = await fetchGet('https://api.bank.co.il/data', {});
    expect(result).toEqual({ data: 'test' });
    const firstCallArgs = MOCK_FETCH.mock.calls[0] as [string, { method: string }];
    expect(firstCallArgs[0]).toBe('https://api.bank.co.il/data');
    expect(firstCallArgs[1].method).toBe('GET');
  });

  it('merges extra headers', async () => {
    const emptyResponse = mockJsonResponse({});
    MOCK_FETCH.mockResolvedValue(emptyResponse);
    await fetchGet('https://api.bank.co.il/data', { Authorization: 'Bearer token' });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { headers: Record<string, string> }])[1];
    expect(callArgs.headers.Authorization).toBe('Bearer token');
    expect(callArgs.headers.Accept).toBe('application/json');
  });

  it('throws when status is not 200', async () => {
    const errorResponse = mockJsonResponse({}, 500);
    MOCK_FETCH.mockResolvedValue(errorResponse);
    const fetchPromise = fetchGet('https://api.bank.co.il/data', {});
    await expect(fetchPromise).rejects.toThrow('status 500');
  });
});

describe('fetchPost', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends POST request with JSON body', async () => {
    const successResponse = mockJsonResponse({ success: true });
    MOCK_FETCH.mockResolvedValue(successResponse);
    const result = await fetchPost('https://api.bank.co.il/login', { user: 'test' });
    expect(result).toEqual({ success: true });
    const callArgs = (MOCK_FETCH.mock.calls[0] as [string, { method: string; body: string }])[1];
    expect(callArgs.method).toBe('POST');
    const expectedBody = JSON.stringify({ user: 'test' });
    expect(callArgs.body).toBe(expectedBody);
  });

  it('returns JSON even on non-200 status', async () => {
    const errorStatusResponse = mockJsonResponse({ error: true }, 500);
    MOCK_FETCH.mockResolvedValue(errorStatusResponse);
    const result = await fetchPost('https://api.bank.co.il/fail', {});
    expect(result).toEqual({ error: true });
  });
});

describe('fetchGraphql', () => {
  beforeEach(() => {
    MOCK_FETCH.mockReset();
  });

  it('sends GraphQL query and returns data', async () => {
    const graphqlResponse = mockJsonResponse({ data: { accounts: [] } });
    MOCK_FETCH.mockResolvedValue(graphqlResponse);
    const result = await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts { id } }');
    expect(result).toEqual({ accounts: [] });
  });

  it('throws when GraphQL response has errors', async () => {
    const errorResponse = mockJsonResponse({ errors: [{ message: 'Unauthorized' }] });
    MOCK_FETCH.mockResolvedValue(errorResponse);
    const graphqlPromise = fetchGraphql('https://api.bank.co.il/graphql', 'query');
    await expect(graphqlPromise).rejects.toThrow('Unauthorized');
  });

  it('sends variables in the request body', async () => {
    const emptyDataResponse = mockJsonResponse({ data: {} });
    MOCK_FETCH.mockResolvedValue(emptyDataResponse);
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
    const serializedBalance = JSON.stringify({ balance: 1000 });
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serializedBalance, 200]),
    });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/balance');
    expect(result).toEqual({ balance: 1000 });
  });

  it('returns empty object for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['', 204]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');
    expect(result).toEqual({});
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    const fetchPromise = fetchGetWithinPage(page, 'https://bank.co.il/api/bad');
    await expect(fetchPromise).rejects.toThrow('parse error');
  });

  it('returns null on invalid JSON when shouldIgnoreErrors is true', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/bad', true);
    expect(result).toBeNull();
  });
});

describe('fetchPostWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const serializedResult = JSON.stringify({ result: 'ok' });
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue([serializedResult, 200]),
    });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/action', {
      data: { key: 'value' },
    });
    expect(result).toEqual({ result: 'ok' });
  });

  it('returns empty object for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['', 204]) });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', { data: {} });
    expect(result).toEqual({});
  });

  it('throws on invalid JSON when shouldIgnoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['invalid json', 200]) });
    const fetchPromise = fetchPostWithinPage(page, 'https://bank.co.il/api/bad', { data: {} });
    await expect(fetchPromise).rejects.toThrow('parse');
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
    const fetchPromise = fetchPostWithinPage(page, 'https://bank.co.il/api/blocked', { data: {} });
    await expect(fetchPromise).rejects.toThrow('status: 403');
  });

  it('passes extraHeaders to page.evaluate as single arg', async () => {
    const serializedOk = JSON.stringify({ ok: true });
    const evaluate = jest.fn().mockResolvedValue([serializedOk, 200]);
    const page = createMockPage({ evaluate });
    await fetchPostWithinPage(page, 'https://bank.co.il/api', {
      data: {},
      extraHeaders: { 'X-Custom': 'val' },
    });
    const evaluateCall = evaluate.mock.calls[0] as [
      (...args: never[]) => string,
      Record<string, string | object>,
    ];
    expect(typeof evaluateCall[0]).toBe('function');
    expect(evaluateCall[1]).toEqual({
      innerUrl: 'https://bank.co.il/api',
      innerDataJson: '{}',
      innerExtraHeaders: { 'X-Custom': 'val' },
    });
  });
});

describe('detectWafBlock', () => {
  it('detects HTTP 429', () => {
    const result429 = detectWafBlock(429, '');
    expect(result429).toBe('HTTP 429');
  });

  it('detects HTTP 503', () => {
    const result503 = detectWafBlock(503, '');
    expect(result503).toBe('HTTP 503');
  });

  it('returns empty string for HTTP 200', () => {
    const result200 = detectWafBlock(200, '');
    expect(result200).toBe('');
  });

  it('detects "block automation" in body', () => {
    const resultBlockAuto = detectWafBlock(200, 'Response: Block Automation detected');
    expect(resultBlockAuto).toBe('response contains "block automation"');
  });

  it('detects "attention required" in body', () => {
    const resultAttention = detectWafBlock(200, '<title>Attention Required! | Cloudflare</title>');
    expect(resultAttention).toBe('response contains "attention required"');
  });

  it('detects "just a moment" in body', () => {
    const resultJustAMoment = detectWafBlock(200, '<title>Just a moment...</title>');
    expect(resultJustAMoment).toBe('response contains "just a moment"');
  });

  it('returns empty string for normal response body', () => {
    const resultNormal = detectWafBlock(200, '{"Header":{"Status":"1"}}');
    expect(resultNormal).toBe('');
  });

  it('does not flag HTTP 403 as WAF — it is a permission error', () => {
    const result403 = detectWafBlock(403, '');
    expect(result403).toBe('');
  });

  it('detects WAF body pattern even on 403', () => {
    const result = detectWafBlock(403, '<title>Attention Required! | Cloudflare</title>');
    expect(result).toBe('response contains "attention required"');
  });
});
