/**
 * Whole-run cancellation reaches the capped native transport: an abort rejects
 * the in-flight request, maps to TIMEOUT, and is never retried.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { runWithBankContext } from '../../../../../Scrapers/Pipeline/Logging/BankContext.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items`;

/**
 * Read the request's abort signal.
 * @param init - The RequestInit handed to fetch.
 * @returns The request signal.
 */
function signalOf(init: RequestInit): AbortSignal {
  if (!init.signal) throw new TypeError('request carries no abort signal');
  return init.signal;
}

describe('capped native transport — whole-run cancellation', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('aborts an in-flight request once and reports TIMEOUT', async () => {
    const controller = new AbortController();
    let calls = 0;
    /**
     * Reject once the request signal aborts.
     * @param _url - Target URL or request.
     * @param init - Request init.
     * @returns A promise rejected by the abort.
     */
    const impl: typeof globalThis.fetch = (_url, init): Promise<Response> => {
      calls += 1;
      if (init === undefined) throw new TypeError('request carries no init');
      const signal = signalOf(init);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          (): boolean => {
            reject(new DOMException('aborted', 'AbortError'));
            return true;
          },
          { once: true },
        );
      });
    };
    globalThis.fetch = impl;
    const strategy = cappedNative(BASE_URL, { timeoutMs: 5000 });
    /**
     * Send one request inside the caller's run scope.
     * @returns The fetch result.
     */
    const run = (): ReturnType<typeof strategy.fetchGet> =>
      strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
    const pending = runWithBankContext('pepper', run, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
    expect(calls).toBe(1);
  });
});
