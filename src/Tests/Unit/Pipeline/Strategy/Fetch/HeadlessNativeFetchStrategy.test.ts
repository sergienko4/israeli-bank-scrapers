/**
 * Unit tests for Strategy/Fetch/HeadlessNativeFetchStrategy — the capped
 * native transport behind `nativeFetch`. globalThis.fetch is replaced with
 * mocks that honour the request's abort signal, so the timeout path runs on a
 * real `AbortSignal.timeout` (no fake timers) with a lowered ceiling.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  HeadlessNativeFetchStrategy,
  NATIVE_REQUEST_TIMEOUT_MS,
  setNativeRequestTimeoutMs,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type MockFetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items?sid=secret`;
const TIMEOUT_MESSAGE = 'GET https://api.bank.example/v1/items network error: timeout';
const LOWERED_CAP_MS = 25;

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
 * Read the abort signal the strategy attached to the request.
 * @param init - The RequestInit handed to fetch.
 * @returns The request's abort signal.
 */
function signalOf(init: RequestInit): AbortSignal {
  if (!init.signal) throw new TypeError('request carries no abort signal');
  return init.signal;
}

/**
 * Build a never-settling promise that rejects with the signal's reason once
 * the request's abort signal fires.
 * @param init - The RequestInit carrying the abort signal.
 * @returns A promise rejected by the abort.
 */
function rejectOnAbort<T>(init: RequestInit): Promise<T> {
  const signal = signalOf(init);
  return new Promise<T>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

/**
 * Mock fetch whose headers never arrive.
 * @param _url - Ignored.
 * @param init - The RequestInit carrying the abort signal.
 * @returns A promise rejected by the abort.
 */
function hangOnHeaders(_url: string, init: RequestInit): Promise<Response> {
  return rejectOnAbort<Response>(init);
}

/**
 * Mock fetch whose headers arrive but whose body never finishes.
 * @param _url - Ignored.
 * @param init - The RequestInit carrying the abort signal.
 * @returns A 200 Response whose body stream errors on abort.
 */
function hangOnBody(_url: string, init: RequestInit): Promise<Response> {
  const signal = signalOf(init);
  const body = new ReadableStream<Uint8Array>({
    /**
     * Error the stream when the request's signal aborts.
     * @param controller - Stream controller.
     * @returns True once the abort listener is attached.
     */
    start(controller): boolean {
      signal.addEventListener('abort', () => {
        controller.error(signal.reason);
      });
      return true;
    },
  });
  const response = new Response(body, { status: 200 });
  return Promise.resolve(response);
}

/**
 * Mock fetch serving a JSON body.
 * @returns A 200 JSON Response.
 */
function serveJson(): Promise<Response> {
  const response = new Response('{"ok":true}', { status: 200 });
  return Promise.resolve(response);
}

/**
 * Read the headers the strategy handed to fetch.
 * @param mock - The fetch mock.
 * @returns The first call's headers record.
 */
function sentHeaders(mock: MockFetch): Record<string, string> {
  const [, init] = mock.mock.calls[0];
  return init.headers as Record<string, string>;
}

describe('HeadlessNativeFetchStrategy', () => {
  let originalFetch: typeof globalThis.fetch;
  const strategy = new HeadlessNativeFetchStrategy(BASE_URL);

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setNativeRequestTimeoutMs(NATIVE_REQUEST_TIMEOUT_MS);
  });

  it.each<[string, MockFetchImpl]>([
    ['headers never arrive', hangOnHeaders],
    ['the body never finishes', hangOnBody],
  ])('fails with a Generic timeout when %s', async (_label, impl) => {
    setNativeRequestTimeoutMs(LOWERED_CAP_MS);
    installFetchMock(impl);
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: TIMEOUT_MESSAGE,
    });
  });

  it('maps a TimeoutError DOMException rejection to the timeout message', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    installFetchMock(() => Promise.reject(timeout));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(TIMEOUT_MESSAGE);
  });

  it('keeps the inherited network-error message for other rejections', async () => {
    installFetchMock(() => Promise.reject(new Error('ECONNRESET')));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe('GET https://api.bank.example/v1/items network error: ECONNRESET');
  });

  it('parses a normal response and sends no content-type on GET', async () => {
    const mock = installFetchMock(serveJson);
    const result = await strategy.fetchGet<{ ok: boolean }>('items', { extraHeaders: {} });
    expect(result).toEqual({ success: true, value: { ok: true } });
    const headers = sentHeaders(mock);
    expect(headers).toEqual({});
  });

  it('sends the JSON content-type on POST with caller headers on top', async () => {
    const mock = installFetchMock(serveJson);
    const extraHeaders = { authorization: 'token' };
    await strategy.fetchPost('items', { id: '1' }, { extraHeaders });
    const headers = sentHeaders(mock);
    expect(headers).toEqual({ 'content-type': 'application/json', authorization: 'token' });
  });
});
