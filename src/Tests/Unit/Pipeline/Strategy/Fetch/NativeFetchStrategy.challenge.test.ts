/**
 * Unbounded Cloudflare challenges — without a response-integrity policy the
 * WAF classifier must read the challenge body, so a configured status action
 * must not abort it while the answer is still header-only.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';
import { CLOUDFLARE_CHALLENGE_HEADERS } from '../../../../Helpers/EdgeBlockPages.js';

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items?sid=secret`;
const LOWERED_CAP_MS = 25;

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
 * Builds a body that errors only if the request aborts before it is read.
 * @param init - The RequestInit carrying the abort signal.
 * @param options - Response status and headers.
 * @returns The abort-sensitive response.
 */
function abortSensitiveResponse(init: RequestInit, options: ResponseInit): Response {
  const signal = signalOf(init);
  /**
   * Emit the challenge body when the request has not aborted.
   * @param controller - Stream controller.
   */
  const pull: NonNullable<UnderlyingSource<Uint8Array>['pull']> = controller => {
    const bytes = new TextEncoder().encode('challenge');
    controller.enqueue(bytes);
    controller.close();
  };
  const body = new ReadableStream<Uint8Array>({
    /**
     * Error the stream if the request aborts before its first pull.
     * @param controller - Stream controller.
     * @returns True once the listener is attached.
     */
    start(controller): boolean {
      signal.addEventListener('abort', () => {
        controller.error(signal.reason);
      });
      return true;
    },
    pull,
  });
  return new Response(body, options);
}

describe('unbounded Cloudflare challenges', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('keeps an abort-sensitive 203 challenge body and reports WAF_BLOCKED', async () => {
    globalThis.fetch = ((_url: string, init: RequestInit): Promise<Response> => {
      const response = abortSensitiveResponse(init, {
        status: 203,
        headers: CLOUDFLARE_CHALLENGE_HEADERS,
      });
      return Promise.resolve(response);
    }) as typeof globalThis.fetch;
    const strategy = cappedNative(BASE_URL, {
      timeoutMs: LOWERED_CAP_MS,
      statusPolicy: { 203: 'fail' },
    });
    const result = await strategy.fetchGet(ITEMS_URL, {
      extraHeaders: {},
      responseKind: 'text',
    });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.WafBlocked,
    });
  });
});
