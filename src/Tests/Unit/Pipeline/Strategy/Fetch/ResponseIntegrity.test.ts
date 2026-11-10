/**
 * Native response limits and digests operate on response bytes before decoding.
 */

import { createHash } from 'node:crypto';

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { verifyResponseIntegrity } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseIntegrityReader.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';

type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

const BASE_URL = 'https://bank.example/';
const SECRET_URL = `${BASE_URL}sdk?private=secret`;

/**
 * Produces a SHA-256 digest for synthetic response bytes.
 * @param bytes - Response bytes.
 * @returns Lowercase digest.
 */
function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Installs a synthetic native fetch implementation.
 * @param impl - Fetch implementation.
 * @returns Mock used to inspect requests.
 */
function install(impl: (url: string, init: RequestInit) => Response): MockFetch {
  const mock = jest.fn<Promise<Response>, [string, RequestInit]>((url, init) => {
    const result = impl(url, init);
    return Promise.resolve(result);
  });
  globalThis.fetch = mock as typeof globalThis.fetch;
  return mock;
}

/**
 * Returns a fresh response for the given bytes.
 * @param bytes - Synthetic response body.
 * @returns Successful response.
 */
function response(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('native response integrity', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('hashes the exact bytes before text decoding, including the UTF-8 BOM', async () => {
    const bytes = new TextEncoder().encode('\uFEFFשלום');
    const mock = install(() => response(bytes));
    const strategy = cappedNative(BASE_URL);
    const policy = { maxBytes: bytes.length, sha256: digest(bytes) };
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseKind: 'text',
      responseIntegrity: policy,
    });
    expect(result).toMatchObject({ success: true, value: { text: 'שלום' } });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refuses a digest mismatch without leaking the URL query or body', async () => {
    const bytes = new TextEncoder().encode('private-body');
    install(() => response(bytes));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseKind: 'text',
      responseIntegrity: { maxBytes: 64, sha256: '0'.repeat(64) },
    });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'response integrity digest mismatch',
      responseIntegrityRefusal: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-body');
    expect(serialized).not.toContain('secret');
  });

  it('aborts and cancels an oversized streamed response', async () => {
    let isCancelled = false;
    let sent = 0;
    const mock = install((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        /**
         * Supplies synthetic chunks until the stream is closed.
         * @param controller - Controller for the source stream.
         */
        pull(controller): void {
          if (sent === 5) {
            controller.close();
          } else {
            sent += 1;
            controller.enqueue(new Uint8Array([1, 2, 3]));
          }
        },
        /**
         * Records cancellation of the source stream.
         */
        cancel(): void {
          isCancelled = true;
        },
      });
      expect(init.signal?.aborted).toBe(false);
      return new Response(body, { status: 200 });
    });
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseKind: 'text',
      responseIntegrity: { maxBytes: 4 },
    });
    expect(result).toMatchObject({ success: false });
    expect(mock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(isCancelled).toBe(true);
    expect(sent).toBeLessThan(8);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 8_388_609])(
    'refuses an invalid byte ceiling %s before making a request',
    async maxBytes => {
      const mock = install(() => response(new Uint8Array()));
      const strategy = cappedNative(BASE_URL);
      const result = await strategy.fetchGet(SECRET_URL, {
        extraHeaders: {},
        responseKind: 'text',
        responseIntegrity: { maxBytes },
      });
      expect(result).toMatchObject({ success: false });
      expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'ABC'.repeat(21) + 'A', 'x'.repeat(64), '0'.repeat(63)])(
    'refuses an invalid digest before making a request',
    async sha256 => {
      const mock = install(() => response(new Uint8Array()));
      const strategy = cappedNative(BASE_URL);
      const result = await strategy.fetchGet(SECRET_URL, {
        extraHeaders: {},
        responseKind: 'text',
        responseIntegrity: { maxBytes: 64, sha256 },
      });
      expect(result).toMatchObject({ success: false });
      expect(mock).not.toHaveBeenCalled();
    },
  );

  it('preserves ordinary native reads when no integrity policy is configured', async () => {
    const bytes = new TextEncoder().encode('ordinary response');
    install(() => response(bytes));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, { extraHeaders: {}, responseKind: 'text' });
    expect(result).toMatchObject({ success: true, value: { text: 'ordinary response' } });
  });

  it('retains the body timeout when a bounded response stalls', async () => {
    install((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        /**
         * Errors the body when the transport aborts its request.
         * @param controller - Controller for the stalled stream.
         * @returns True once the abort handler is installed.
         */
        start(controller): boolean {
          init.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
          return true;
        },
      });
      return new Response(body, { status: 200 });
    });
    const strategy = cappedNative(BASE_URL, { timeoutMs: 25 });
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 64 },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
  });

  it('fails a bounded read when a rejected error name cannot be inspected', async () => {
    const error = {
      /**
       * Simulates an unreadable rejection value.
       * @returns Never; the name is inaccessible.
       */
      get name(): string {
        throw new TypeError('unreadable error name');
      },
    };
    const body = new ReadableStream<Uint8Array>({
      /**
       * Rejects the synthetic response stream.
       * @param controller - Stream controller.
       */
      start(controller): void {
        controller.error(error);
      },
    });
    const original = new Response('synthetic');
    jest.spyOn(original, 'clone').mockReturnValue(new Response(body));
    const controller = new AbortController();
    const result = verifyResponseIntegrity(original, { maxBytes: 64 }, controller);
    await expect(result).rejects.toThrow('response stream read failed');
    expect(controller.signal.aborted).toBe(true);
  });

  it('preserves a header-only status decision without reading or hashing the body', async () => {
    let pulls = 0;
    install(() => {
      const body = new ReadableStream<Uint8Array>(
        {
          /**
           * Counts attempted reads of the undecided body.
           */
          pull: (): void => {
            pulls += 1;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: 201 });
    });
    const strategy = cappedNative(BASE_URL, {
      statusPolicy: { 201: 'empty' },
      responseIntegrity: { maxBytes: 1, sha256: '0'.repeat(64) },
    });
    const result = await strategy.fetchGet(SECRET_URL, { extraHeaders: {} });
    expect(result).toMatchObject({ success: true, value: {} });
    expect(pulls).toBe(0);
  });

  it('checks a manual redirect from headers before verifying the final body', async () => {
    let pulls = 0;
    const bytes = new TextEncoder().encode('done');
    const mock = install(() => {
      if (mock.mock.calls.length > 1) return response(bytes);
      const body = new ReadableStream<Uint8Array>(
        {
          /**
           * Counts attempted reads of the redirect body.
           */
          pull: (): void => {
            pulls += 1;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, {
        status: 302,
        headers: { location: `${BASE_URL}final` },
      });
    });
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseKind: 'text',
      responseIntegrity: { maxBytes: bytes.length, sha256: digest(bytes) },
      redirect: { maxHops: 1, allow: [{ origin: 'https://bank.example', paths: ['/final'] }] },
    });
    expect(result).toMatchObject({ success: true, value: { text: 'done' } });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(pulls).toBe(0);
  });

  it('refuses a mismatched media type before reading or hashing the body', async () => {
    let pulls = 0;
    install(() => {
      const body = new ReadableStream<Uint8Array>(
        {
          /**
           * Counts attempted reads of the refused body.
           */
          pull: (): void => {
            pulls += 1;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      mediaType: 'application/json',
      responseIntegrity: { maxBytes: 1, sha256: '0'.repeat(64) },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('media type');
    expect(pulls).toBe(0);
  });

  it('classifies a bounded WAF block instead of masking it as a digest mismatch', async () => {
    const body = '<html><div class="cf-error">cloudflare</div></html>';
    install(() => new Response(body, { status: 403 }));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 128, sha256: '0'.repeat(64) },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('cf-error');
  });

  it('classifies an oversized WAF block when its markers fit within the byte limit', async () => {
    const body = '<html><div class="cf-error">cloudflare</div>' + 'x'.repeat(256);
    install(() => new Response(body, { status: 403 }));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 64 },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('cf-error');
  });

  it('does not classify WAF markers outside the permitted response prefix', async () => {
    const body = '<html>' + 'x'.repeat(64) + '<div class="cf-error">cloudflare</div>';
    install(() => new Response(body, { status: 403 }));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 64 },
    });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'response exceeds integrity byte limit',
      responseIntegrityRefusal: true,
    });
  });

  it('recognizes block markers split across response chunks', async () => {
    const chunks = ['<html><div class="cf-', 'error">cloud', 'flare</div>', 'x'.repeat(256)];
    const body = new ReadableStream<Uint8Array>({
      /**
       * Delivers the synthetic response in separate chunks.
       * @param controller - Source stream controller.
       */
      start(controller): void {
        const encoder = new TextEncoder();
        chunks.forEach(chunk => {
          const bytes = encoder.encode(chunk);
          controller.enqueue(bytes);
        });
        controller.close();
      },
    });
    install(() => new Response(body, { status: 403 }));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 64 },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
  });

  it('does not classify oversized 5xx edge pages as WAF blocks', async () => {
    const body = '<html><div class="cf-error">cloudflare</div>' + 'x'.repeat(256);
    install(() => new Response(body, { status: 503 }));
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 64 },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('returns an overflow refusal even if stream cancellation never settles', async () => {
    const body = new ReadableStream<Uint8Array>({
      /**
       * Supplies an oversized chunk without ending the stream.
       * @param controller - Source stream controller.
       */
      start(controller): void {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      /** Simulates an underlying source that never finishes cancellation. */
      cancel(): Promise<void> {
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const result = verifyResponseIntegrity(new Response(body), { maxBytes: 1 }, controller);
    const signal = AbortSignal.timeout(100);
    const watchdog = new Promise<string>(resolve => {
      signal.addEventListener('abort', () => {
        resolve('cancellation stalled');
      });
    });
    const outcome = await Promise.race([result, watchdog]);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'response exceeds integrity byte limit',
    });
    expect(controller.signal.aborted).toBe(true);
  });

  it('classifies a challenge header without reading its unbounded body', async () => {
    let pulls = 0;
    install(() => {
      const body = new ReadableStream<Uint8Array>(
        {
          /**
           * Counts attempted reads of the challenge body.
           */
          pull(): void {
            pulls += 1;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: 200, headers: { 'cf-mitigated': 'challenge' } });
    });
    const strategy = cappedNative(BASE_URL);
    const result = await strategy.fetchGet(SECRET_URL, {
      extraHeaders: {},
      responseIntegrity: { maxBytes: 1, sha256: '0'.repeat(64) },
    });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
    expect(pulls).toBe(0);
  });
});
