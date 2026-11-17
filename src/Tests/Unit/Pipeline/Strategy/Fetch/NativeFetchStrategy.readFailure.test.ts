/**
 * Capped body-read failures: a broken success body stays a transport
 * failure, while an abort during a non-2xx read stays TIMEOUT.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items`;

/**
 * Install a fetch response for the next request.
 * @param response - Response the strategy receives.
 * @returns Nothing.
 */
function serve(response: Response): true {
  /**
   * Answer with the prepared response.
   * @returns The response.
   */
  const impl = (): Promise<Response> => Promise.resolve(response);
  globalThis.fetch = impl;
  return true;
}

/**
 * Build a body that fails before it can be read.
 * @param error - Error installed on the stream.
 * @returns The broken body.
 */
function brokenBody(error: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    /**
     * Install the stream failure.
     * @param controller - Stream controller.
     * @returns True once installed.
     */
    start(controller): boolean {
      controller.error(error);
      return true;
    },
  });
}

describe('capped NativeFetchStrategy — body-read failures', () => {
  const originalFetch = globalThis.fetch;
  const strategy = cappedNative(BASE_URL, { timeoutMs: 1000 });

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('keeps a broken success body as a transport failure', async () => {
    serve(new Response(brokenBody(new Error('ECONNRESET')), { status: 200 }));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('keeps an abort during a failed body read as a timeout', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    serve(new Response(brokenBody(aborted), { status: 500 }));
    const result = await strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
  });
});
