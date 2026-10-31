/**
 * Unit tests for Strategy/Fetch/HeadlessNativeFetchStrategy — the capped
 * native transport behind `nativeFetch`. globalThis.fetch is replaced with
 * mocks that honour the request's abort signal, so the timeout path runs on a
 * real `AbortSignal.timeout` (no fake timers) on a strategy built with a
 * lowered ceiling.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { HeadlessNativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { IManualRedirect } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
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
  const capped = new HeadlessNativeFetchStrategy(BASE_URL, { timeoutMs: LOWERED_CAP_MS });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each<[string, MockFetchImpl]>([
    ['headers never arrive', hangOnHeaders],
    ['the body never finishes', hangOnBody],
  ])('fails with a Timeout error when %s', async (_label, impl) => {
    installFetchMock(impl);
    const result = await capped.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
      errorMessage: TIMEOUT_MESSAGE,
    });
  });

  it.each(['TimeoutError', 'AbortError'])('maps a rejected %s to a Timeout', async name => {
    const timeout = new DOMException('The operation was aborted', name);
    installFetchMock(() => Promise.reject(timeout));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
      errorMessage: TIMEOUT_MESSAGE,
    });
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

const START_URL = `${BASE_URL}start`;
const HOP_URL = `${BASE_URL}next`;
const ONE_HOP: IManualRedirect = {
  maxHops: 1,
  allow: [{ origin: 'https://api.bank.example', paths: ['/v1/next'] }],
};

/**
 * Mock fetch: the start URL answers 302 to the hop, and the hop hangs until
 * its own abort signal fires.
 * @param url - Requested URL.
 * @param init - The RequestInit carrying the abort signal.
 * @returns The redirect, or a promise rejected by the hop's abort.
 */
function redirectThenHang(url: string, init: RequestInit): Promise<Response> {
  if (url === HOP_URL) return rejectOnAbort<Response>(init);
  const response = new Response(null, { status: 302, headers: { location: HOP_URL } });
  return Promise.resolve(response);
}

describe('HeadlessNativeFetchStrategy — redirect policy', () => {
  let originalFetch: typeof globalThis.fetch;
  const plain = new HeadlessNativeFetchStrategy(BASE_URL);
  const rejecting = new HeadlessNativeFetchStrategy(BASE_URL, { redirectPolicy: 'reject' });
  const hopping = new HeadlessNativeFetchStrategy(BASE_URL, {
    timeoutMs: LOWERED_CAP_MS,
    redirectPolicy: ONE_HOP,
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('refuses a redirect under the bank default', async () => {
    installFetchMock(redirectThenHang);
    const result = await rejecting.fetchGet('start', { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(`GET ${START_URL} HTTP 302 redirect refused`);
  });

  it("lets a call's own policy override the bank default", async () => {
    const mock = installFetchMock(serveJson);
    await rejecting.fetchGet('start', { extraHeaders: {}, redirect: 'follow' });
    const [, init] = mock.mock.calls[0];
    expect(init).not.toHaveProperty('redirect');
  });

  it('leaves redirects to fetch without a policy', async () => {
    const mock = installFetchMock(serveJson);
    await plain.fetchPost('start', { id: '1' }, { extraHeaders: {} });
    const [, init] = mock.mock.calls[0];
    expect(init).not.toHaveProperty('redirect');
  });

  it('caps every redirect hop at the timeout', async () => {
    const mock = installFetchMock(redirectThenHang);
    const result = await hopping.fetchGet('start', { extraHeaders: {} });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
