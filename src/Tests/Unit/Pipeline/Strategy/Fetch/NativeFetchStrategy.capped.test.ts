/**
 * Unit tests for the capped native transport behind `nativeFetch`.
 * globalThis.fetch is replaced with mocks that honour the request's abort
 * signal, so the timeout path runs on a real `AbortSignal.timeout` (no fake
 * timers) on a strategy built with a lowered ceiling.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { NETWORK_CONNECT_RETRIES } from '../../../../../Scrapers/Pipeline/Mediator/Network/FetchConfig.js';
import type {
  IManualRedirect,
  StatusAction,
} from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { cappedGraphQL, cappedNative } from '../../../../Helpers/CappedTransport.js';

type MockFetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items?sid=secret`;
const TIMEOUT_MESSAGE = 'GET https://api.bank.example/v1/items network error: timeout';
const MEDIA_REFUSAL = 'GET https://api.bank.example/v1/items unexpected media type';
const LOWERED_CAP_MS = 25;
const STATUS_RESULTS = {
  empty: { success: true, value: {} },
  fail: {
    success: false,
    errorType: ScraperErrorTypes.Generic,
    errorMessage: 'GET https://api.bank.example/v1/items HTTP 200',
  },
};

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
 * Builds an unread body that remains open until its request is aborted.
 * @param init - The RequestInit carrying the abort signal.
 * @param options - Response status and headers.
 * @param pull - Optional recorder of attempted body reads.
 * @returns The response whose stream errors on abort.
 */
function hangingResponse(
  init: RequestInit,
  options: ResponseInit,
  pull?: UnderlyingSource<Uint8Array>['pull'],
): Response {
  const signal = signalOf(init);
  const body = new ReadableStream<Uint8Array>(
    {
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
      pull,
    },
    { highWaterMark: 0 },
  );
  return new Response(body, options);
}

/**
 * Mock fetch whose headers arrive but whose body never finishes.
 * @param _url - Ignored.
 * @param init - The RequestInit carrying the abort signal.
 * @returns A 200 Response whose body stream errors on abort.
 */
function hangOnBody(_url: string, init: RequestInit): Promise<Response> {
  const response = hangingResponse(init, { status: 200 });
  return Promise.resolve(response);
}

/**
 * Mock a rate limit whose body never finishes.
 * @param _url - Ignored.
 * @param init - The RequestInit carrying the abort signal.
 * @returns A 429 response with a stalled body.
 */
function hangOnRateLimit(_url: string, init: RequestInit): Promise<Response> {
  const response = hangingResponse(init, { status: 429 });
  return Promise.resolve(response);
}

/**
 * Answer with headers but an already-failed body stream.
 * @returns A response whose body cannot be consumed.
 */
function brokenBody(): Promise<Response> {
  const body = new ReadableStream<Uint8Array>({
    /**
     * Fail the stream before a reader can consume it.
     * @param controller - Stream controller.
     * @returns True once the failure is installed.
     */
    start(controller): boolean {
      controller.error(new Error('ECONNRESET'));
      return true;
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
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

describe('capped NativeFetchStrategy', () => {
  let originalFetch: typeof globalThis.fetch;
  const strategy = cappedNative(BASE_URL);
  const capped = cappedNative(BASE_URL, { timeoutMs: LOWERED_CAP_MS });

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

  it.each<[Exclude<StatusAction, 'rate-limit'>, string, MockFetchImpl]>([
    ['empty', 'stalled', hangOnBody],
    ['empty', 'broken', brokenBody],
    ['fail', 'stalled', hangOnBody],
    ['fail', 'broken', brokenBody],
  ])('decides %s without consuming a %s body', async (action, _label, impl) => {
    const guarded = cappedNative(BASE_URL, {
      timeoutMs: LOWERED_CAP_MS,
      statusPolicy: { 200: action },
    });
    const mock = installFetchMock(impl);
    const result = await guarded.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject(STATUS_RESULTS[action]);
    expect(signalOf(mock.mock.calls[0][1]).aborted).toBe(true);
  });

  it('reports an opted-in 429 without consuming a stalled body', async () => {
    const guarded = cappedNative(BASE_URL, {
      timeoutMs: LOWERED_CAP_MS,
      statusPolicy: { 429: 'rate-limit' },
    });
    const mock = installFetchMock(hangOnRateLimit);
    const result = await guarded.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
      errorMessage: 'GET https://api.bank.example/v1/items 429: rate limited',
    });
    expect(signalOf(mock.mock.calls[0][1]).aborted).toBe(true);
  });

  it('keeps an unconfigured 429 under the shared failure policy', async () => {
    installFetchMock(() => Promise.resolve(new Response('slow down', { status: 429 })));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('refuses a bank media-type mismatch without waiting for a stalled body', async () => {
    const guarded = cappedNative(BASE_URL, {
      timeoutMs: LOWERED_CAP_MS,
      mediaTypes: { json: 'application/json' },
    });
    const pull = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const mock = installFetchMock((_url, init): Promise<Response> => {
      const response = hangingResponse(init, { status: 200 }, pull);
      return Promise.resolve(response);
    });
    const result = await guarded.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: MEDIA_REFUSAL,
    });
    expect(pull).not.toHaveBeenCalled();
    expect(signalOf(mock.mock.calls[0][1]).aborted).toBe(true);
  });

  it('refuses a per-call media-type mismatch before reading a broken body', async () => {
    const guarded = cappedNative(BASE_URL, { timeoutMs: LOWERED_CAP_MS });
    const mock = installFetchMock(brokenBody);
    const opts = { extraHeaders: {}, mediaType: 'application/json' };
    const result = await guarded.fetchGet(ITEMS_URL, opts);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: MEDIA_REFUSAL,
    });
    expect(signalOf(mock.mock.calls[0][1]).aborted).toBe(true);
  });

  it('keeps and checks an accepted redirect body', async () => {
    installFetchMock(() =>
      Promise.resolve(
        new Response('accepted-body', { status: 302, headers: { location: ITEMS_URL } }),
      ),
    );
    const opts = { extraHeaders: {}, redirect: 'accept' as const, responseKind: 'text' as const };
    const result = await capped.fetchGet<{ text: string }>(ITEMS_URL, opts);
    expect(result).toEqual({ success: true, value: { text: 'accepted-body' } });
  });

  it('applies response integrity to an accepted redirect body', async () => {
    installFetchMock(() =>
      Promise.resolve(new Response('too-large', { status: 302, headers: { location: ITEMS_URL } })),
    );
    const opts = {
      extraHeaders: {},
      redirect: 'accept' as const,
      responseKind: 'text' as const,
      responseIntegrity: { maxBytes: 4 },
    };
    const result = await capped.fetchGet(ITEMS_URL, opts);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(!isOk(result) && result.errorMessage).toContain('response exceeds integrity byte limit');
  });

  it('applies the SHA-256 digest to an accepted redirect body', async () => {
    installFetchMock(() =>
      Promise.resolve(
        new Response('fingerprinted', { status: 302, headers: { location: ITEMS_URL } }),
      ),
    );
    const opts = {
      extraHeaders: {},
      redirect: 'accept' as const,
      responseKind: 'text' as const,
      responseIntegrity: { maxBytes: 100, sha256: '0'.repeat(64) },
    };
    const result = await capped.fetchGet(ITEMS_URL, opts);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(!isOk(result) && result.errorMessage).toBe('response integrity digest mismatch');
  });

  it('classifies a Cloudflare challenge before rebuilding an accepted redirect', async () => {
    const broken = new ReadableStream<Uint8Array>({
      /**
       * Fail the stream before a reader can consume it.
       * @param controller - Stream controller.
       * @returns True once the failure is installed.
       */
      start(controller): boolean {
        controller.error(new Error('ECONNRESET'));
        return true;
      },
    });
    const headers = { location: ITEMS_URL, 'cf-mitigated': 'challenge' };
    installFetchMock(() => Promise.resolve(new Response(broken, { status: 302, headers })));
    const opts = {
      extraHeaders: {},
      redirect: 'accept' as const,
      responseKind: 'text' as const,
      responseIntegrity: { maxBytes: 100 },
    };
    const result = await capped.fetchGet(ITEMS_URL, opts);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
  });

  it("files an accepted redirect's cookies once through the dispatcher", async () => {
    installFetchMock(() =>
      Promise.resolve(
        new Response('ok', {
          status: 302,
          headers: { location: ITEMS_URL, 'set-cookie': 'a=1' },
        }),
      ),
    );
    const onSetCookie = jest.fn<number, [readonly string[], string?]>(() => 1);
    const opts = {
      extraHeaders: {},
      redirect: 'accept' as const,
      responseKind: 'text' as const,
      onSetCookie,
    };
    await capped.fetchGet(ITEMS_URL, opts);
    expect(onSetCookie).toHaveBeenCalledTimes(1);
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
const CONNECT_RETRY_REASON = 'network error: fetch failed (UND_ERR_CONNECT_TIMEOUT)';

/**
 * Node's rejection when no handshake completed within its connect budget.
 * @param code - The `cause.code` undici reports.
 * @returns The bare `fetch failed` error carrying the code.
 */
function fetchFailedWith(code: string): TypeError {
  return new TypeError('fetch failed', { cause: { code } });
}

/**
 * Mock fetch that fails to connect a number of times, then serves JSON.
 * @param failures - How many leading calls fail to connect.
 * @returns The mock implementation.
 */
function connectTimeoutsThenJson(failures: number): MockFetchImpl {
  let calls = 0;
  return (): Promise<Response> => {
    calls += 1;
    if (calls > failures) return serveJson();
    const rejection = fetchFailedWith('UND_ERR_CONNECT_TIMEOUT');
    return Promise.reject(rejection);
  };
}

describe('capped NativeFetchStrategy — connect timeout retry', () => {
  let originalFetch: typeof globalThis.fetch;
  const strategy = cappedNative(BASE_URL, { redirectPolicy: 'reject' });
  const following = cappedNative(BASE_URL);
  const postHopping = cappedNative(BASE_URL, {
    redirectPolicy: { ...ONE_HOP, postAsGet: true },
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries a connect timeout on a fresh attempt signal and succeeds', async () => {
    const impl = connectTimeoutsThenJson(2);
    const mock = installFetchMock(impl);
    const result = await strategy.fetchPost('items', { id: '1' }, { extraHeaders: {} });
    expect(result).toEqual({ success: true, value: { ok: true } });
    expect(mock).toHaveBeenCalledTimes(3);
    const signals = mock.mock.calls.map(([, init]) => signalOf(init));
    expect(new Set(signals).size).toBe(3);
  });

  it('does not retry a bounded GraphQL request when the bank opts out', async () => {
    const gql = cappedGraphQL(
      BASE_URL,
      {},
      {
        redirectPolicy: 'reject',
        responseIntegrity: { maxBytes: 64 },
        isConnectRetryDisabled: true,
      },
    );
    const impl = connectTimeoutsThenJson(1);
    const mock = installFetchMock(impl);
    const result = await gql.query('query { ok }', {});
    expect(result.success).toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('preserves a response-integrity refusal after a connect retry', async () => {
    const bounded = cappedNative(BASE_URL, {
      redirectPolicy: 'reject',
      responseIntegrity: { maxBytes: 2 },
    });
    const impl = connectTimeoutsThenJson(1);
    const mock = installFetchMock(impl);
    const result = await bounded.fetchGet('items', { extraHeaders: {} });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'response exceeds integrity byte limit',
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not resend a POST when a redirect target times out under follow', async () => {
    const impl = connectTimeoutsThenJson(1);
    const mock = installFetchMock(impl);
    const result = await following.fetchPost('items', { id: '1' }, { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(`POST https://api.bank.example/v1/items ${CONNECT_RETRY_REASON}`);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('retries only the failed hop of a manual redirect, never the original POST', async () => {
    const urls: string[] = [];
    let hopAttempts = 0;
    installFetchMock((url): Promise<Response> => {
      urls.push(url);
      if (url !== HOP_URL) {
        const headers = { location: HOP_URL };
        return Promise.resolve(new Response(null, { status: 303, headers }));
      }
      hopAttempts += 1;
      if (hopAttempts > 1) return serveJson();
      const rejection = fetchFailedWith('UND_ERR_CONNECT_TIMEOUT');
      return Promise.reject(rejection);
    });
    const result = await postHopping.fetchPost('start', { id: '1' }, { extraHeaders: {} });
    expect(result).toEqual({ success: true, value: { ok: true } });
    expect(urls).toEqual([START_URL, HOP_URL, HOP_URL]);
  });

  it('gives up after the retry budget and reports the cause code', async () => {
    const impl = connectTimeoutsThenJson(Number.POSITIVE_INFINITY);
    const mock = installFetchMock(impl);
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(`GET https://api.bank.example/v1/items ${CONNECT_RETRY_REASON}`);
    expect(mock).toHaveBeenCalledTimes(NETWORK_CONNECT_RETRIES + 1);
  });

  it.each(['ECONNRESET', 'ENOTFOUND', 'UND_ERR_SOCKET'])(
    'does not retry a %s failure',
    async code => {
      const rejection = fetchFailedWith(code);
      const mock = installFetchMock(() => Promise.reject(rejection));
      const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
      const message = !isOk(result) && result.errorMessage;
      expect(message).toBe(
        `GET https://api.bank.example/v1/items network error: fetch failed (${code})`,
      );
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry a timeout abort', async () => {
    const timeout = new DOMException('The operation was aborted', 'TimeoutError');
    const mock = installFetchMock(() => Promise.reject(timeout));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('keeps the query string out of the reported failure', async () => {
    const impl = connectTimeoutsThenJson(Number.POSITIVE_INFINITY);
    installFetchMock(impl);
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const message = !isOk(result) && result.errorMessage;
    expect(message).not.toContain('secret');
  });
});

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

describe('capped NativeFetchStrategy — redirect policy', () => {
  let originalFetch: typeof globalThis.fetch;
  const plain = cappedNative(BASE_URL);
  const rejecting = cappedNative(BASE_URL, { redirectPolicy: 'reject' });
  const hopping = cappedNative(BASE_URL, {
    timeoutMs: LOWERED_CAP_MS,
    redirectPolicy: ONE_HOP,
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    {
      label: 'reject',
      policy: 'reject',
      expected: { success: false, errorMessage: `GET ${START_URL} HTTP 302 redirect refused` },
      calls: 1,
      events: [START_URL, 'cookies'],
    },
    {
      label: 'manual',
      policy: ONE_HOP,
      expected: { success: true, value: { ok: true } },
      calls: 2,
      events: [START_URL, 'cookies', HOP_URL],
    },
  ] as const)('handles a stalled $label redirect without reading its body', async testCase => {
    const pull = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const events: string[] = [];
    const mock = installFetchMock((url, init): Promise<Response> => {
      events.push(url);
      if (url === HOP_URL) return serveJson();
      const headers = { location: HOP_URL, 'set-cookie': 'sid=synthetic; Path=/' };
      const response = hangingResponse(init, { status: 302, headers }, pull);
      return Promise.resolve(response);
    });
    const guarded = cappedNative(BASE_URL, { timeoutMs: LOWERED_CAP_MS });
    const onSetCookie = jest.fn((): number => events.push('cookies'));
    const opts = { extraHeaders: {}, redirect: testCase.policy, onSetCookie };
    const result = await guarded.fetchGet('start', opts);
    expect(result).toMatchObject(testCase.expected);
    expect(pull).not.toHaveBeenCalled();
    expect(signalOf(mock.mock.calls[0][1]).aborted).toBe(true);
    expect(mock).toHaveBeenCalledTimes(testCase.calls);
    expect(events).toEqual(testCase.events);
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
