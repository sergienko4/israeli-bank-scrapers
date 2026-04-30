/**
 * Unit tests for Strategy/Fetch/NativeFetchStrategy — real implementation.
 * Mocks globalThis.fetch; covers POST/GET success, 4xx, 5xx, parse error,
 * malformed JSON, header override, Bearer propagation, and network throw.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { NativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type MockFetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

interface IFetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * Install a replacement for globalThis.fetch that delegates to impl.
 * @param impl - The mock implementation to drive fetch calls.
 * @returns The jest mock for call-capture assertions.
 */
function installFetchMock(impl: MockFetchImpl): MockFetch {
  const mock = jest.fn<Promise<Response>, [string, RequestInit]>(impl);
  (globalThis as unknown as { fetch: MockFetch }).fetch = mock;
  return mock;
}

/**
 * Build a fake Response object with the given status + body text.
 * @param status - HTTP status code to report.
 * @param bodyText - Raw body text returned by response.text().
 * @returns A Response-shaped object suitable for the mock fetch.
 */
function buildResponse(status: number, bodyText: string): Response {
  const isOkStatus = status >= 200 && status < 300;
  /**
   * Return the canned body text when fetch callers invoke response.text().
   * @returns Promise resolving to the canned body text.
   */
  const textFn = (): Promise<string> => Promise.resolve(bodyText);
  const responseLike = { ok: isOkStatus, status, text: textFn };
  return responseLike as unknown as Response;
}

/**
 * Build an impl that resolves with a prefabricated Response.
 * @param status - HTTP status code for the response.
 * @param bodyText - Body text to serve from the response.
 * @returns A MockFetchImpl that always resolves with the response.
 */
function respondWith(status: number, bodyText: string): MockFetchImpl {
  const response = buildResponse(status, bodyText);
  const promised = Promise.resolve(response);
  /**
   * Mock impl closure — ignores args and returns the canned response.
   * @returns The canned resolved Promise.
   */
  const impl: MockFetchImpl = () => promised;
  return impl;
}

/**
 * Build an impl that rejects with the given error on each call.
 * Freshly rejects each invocation to avoid unhandled-rejection warnings
 * when the caller consumes the mock lazily.
 * @param error - The error value to reject with.
 * @returns A MockFetchImpl that always rejects with the error.
 */
function rejectWith(error: Error): MockFetchImpl {
  /**
   * Mock impl closure — returns a fresh rejected Promise each call.
   * @returns A new rejected Promise wrapping the same error.
   */
  const impl: MockFetchImpl = () => Promise.reject(error);
  return impl;
}

/**
 * Extract the first captured fetch call (url + init).
 * @param mock - The jest mock to read from.
 * @returns Structured { url, init } of the first recorded call.
 */
function firstCall(mock: MockFetch): IFetchCall {
  const capturedCall = mock.mock.calls[0];
  return { url: capturedCall[0], init: capturedCall[1] };
}

/**
 * Parse the JSON body string back into a record for assertion.
 * @param init - The captured RequestInit whose body is inspected.
 * @returns Parsed record representation of the JSON body.
 */
function parseBody(init: RequestInit): Record<string, unknown> {
  const body = init.body as string;
  return JSON.parse(body) as Record<string, unknown>;
}

describe('NativeFetchStrategy.fetchPost — success path', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns succeed(parsed) and calls fetch with URL, POST, JSON body, merged headers', async () => {
    const payload = JSON.stringify({ ok: true, echo: 'hi' });
    const impl = respondWith(200, payload);
    const fetchMock = installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost<{ ok: boolean; echo: string }>(
      'https://api.example/x',
      { key: 'v' },
      { extraHeaders: { 'X-Trace': 't1' } },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toEqual({ ok: true, echo: 'hi' });
    const capturedCall = firstCall(fetchMock);
    expect(capturedCall.url).toBe('https://api.example/x');
    expect(capturedCall.init.method).toBe('POST');
    const headers = capturedCall.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['X-Trace']).toBe('t1');
    const parsedBody = parseBody(capturedCall.init);
    expect(parsedBody).toEqual({ key: 'v' });
  });

  it('propagates caller Bearer in extraHeaders to the outbound request', async () => {
    const impl = respondWith(200, '{"ok":true}');
    const fetchMock = installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost(
      'https://api.example/secure',
      { id: '1' },
      { extraHeaders: { Authorization: 'Bearer abc123' } },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const capturedCall = firstCall(fetchMock);
    const headers = capturedCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc123');
  });

  it('lets caller content-type override default JSON content-type', async () => {
    const impl = respondWith(200, '{"ok":true}');
    const fetchMock = installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost(
      'https://api.example/x',
      { key: 'v' },
      { extraHeaders: { 'content-type': 'text/plain' } },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const capturedCall = firstCall(fetchMock);
    const headers = capturedCall.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('text/plain');
  });
});

describe('NativeFetchStrategy.fetchGet — success path', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns succeed(parsed) and calls fetch with URL, GET, merged headers, no body', async () => {
    const payload = '{"items":["one","two"]}';
    const impl = respondWith(200, payload);
    const fetchMock = installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchGet<{ items: string[] }>('https://api.example/list', {
      extraHeaders: { 'X-Trace': 'g1' },
    });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.items).toEqual(['one', 'two']);
    const capturedCall = firstCall(fetchMock);
    expect(capturedCall.url).toBe('https://api.example/list');
    expect(capturedCall.init.method).toBe('GET');
    expect(capturedCall.init.body).toBeUndefined();
    const headers = capturedCall.init.headers as Record<string, string>;
    expect(headers['X-Trace']).toBe('g1');
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('NativeFetchStrategy — failure paths', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns fail with 4xx status embedded in message', async () => {
    const impl = respondWith(404, 'not found snippet');
    installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost(
      'https://api.example/x',
      { a: '1' },
      { extraHeaders: {} },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('404');
      expect(result.errorMessage).toContain('https://api.example/x');
    }
  });

  it('returns fail with 5xx status embedded in message', async () => {
    const impl = respondWith(502, 'bad gateway snippet');
    installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchGet('https://api.example/x', { extraHeaders: {} });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('502');
    }
  });

  it('returns fail with "parse error" when the body is not valid JSON', async () => {
    const impl = respondWith(200, 'not-json-at-all');
    installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost('https://api.example/x', {}, { extraHeaders: {} });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('parse error');
    }
  });

  it('returns fail with "network error" when fetch throws', async () => {
    const networkError = new Error('connection refused');
    const impl = rejectWith(networkError);
    installFetchMock(impl);
    const strategy = new NativeFetchStrategy('https://api.example');
    const result = await strategy.fetchPost(
      'https://api.example/x',
      { k: 'v' },
      { extraHeaders: {} },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('network error');
      expect(result.errorMessage).toContain('connection refused');
    }
  });
});
