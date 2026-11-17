/**
 * Whole-run cancellation reaches the capped native transport: an abort rejects
 * the in-flight request, maps to TIMEOUT, and is never retried.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { runWithBankContext } from '../../../../../Scrapers/Pipeline/Logging/BankContext.js';
import type { NativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';

const BASE_URL = 'https://api.bank.example/v1/';
const ITEMS_URL = `${BASE_URL}items`;

/** A fetch mock that rejects on abort and counts its calls. */
interface IAbortingFetch {
  readonly impl: typeof globalThis.fetch;
  readonly calls: () => number;
}

/** A request started under a run scope the test can abort. */
interface IStartedRequest {
  readonly controller: AbortController;
  readonly pending: ReturnType<NativeFetchStrategy['fetchGet']>;
}

/**
 * Read the request's abort signal.
 * @param init - The RequestInit handed to fetch.
 * @returns The request signal.
 */
function signalOf(init: RequestInit): AbortSignal {
  if (!init.signal) throw new TypeError('request carries no abort signal');
  return init.signal;
}

/**
 * Build a fetch mock that rejects with the supplied error once aborted.
 * @param rejection - Builds the abort rejection.
 * @returns The mock implementation and its call count.
 */
function abortingFetch(rejection: () => Error): IAbortingFetch {
  let calls = 0;
  /**
   * Reject the request when its signal aborts.
   * @param _input - Ignored request target.
   * @param init - Request init carrying the abort signal.
   * @returns A promise rejected by the abort.
   */
  const impl: typeof globalThis.fetch = (_input, init): Promise<Response> => {
    calls += 1;
    const signal = signalOf(init ?? {});
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        (): boolean => {
          const reason = rejection();
          reject(reason);
          return true;
        },
        { once: true },
      );
    });
  };
  /**
   * Read the fetch call count.
   * @returns How many requests were attempted.
   */
  const callCount = (): number => calls;
  return { impl, calls: callCount };
}

/**
 * Start one request under a run scope the test can abort.
 * @param strategy - Transport under test.
 * @returns The controller and the pending result.
 */
function startRequest(strategy: NativeFetchStrategy): IStartedRequest {
  const controller = new AbortController();
  /**
   * Send one GET inside the caller's run scope.
   * @returns The fetch result.
   */
  const work = (): ReturnType<typeof strategy.fetchGet> =>
    strategy.fetchGet(ITEMS_URL, { extraHeaders: {} });
  const pending = runWithBankContext('pepper', work, { signal: controller.signal });
  return { controller, pending };
}

/**
 * Assert a cancelled request failed as TIMEOUT without a second attempt.
 * @param started - The started request.
 * @param calls - Fetch call count.
 * @returns True after the assertions.
 */
async function expectNoRetry(started: IStartedRequest, calls: () => number): Promise<true> {
  const result = await started.pending;
  expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
  const attempts = calls();
  expect(attempts).toBe(1);
  return true;
}

describe('capped native transport — whole-run cancellation', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes a custom abort reason to TIMEOUT', async () => {
    const reason = new Error('cancelled by caller');
    const mock = abortingFetch(() => reason);
    globalThis.fetch = mock.impl;
    const strategy = cappedNative(BASE_URL, { timeoutMs: 5000 });
    const started = startRequest(strategy);
    started.controller.abort(reason);
    const result = await started.pending;
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Timeout });
    const message = !result.success && result.errorMessage;
    expect(message).not.toContain('cancelled by caller');
    const attempts = mock.calls();
    expect(attempts).toBe(1);
  });

  it('aborts an in-flight request once and reports TIMEOUT', async () => {
    /**
     * Build a transport abort rejection.
     * @returns An error named `AbortError`.
     */
    const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });
    const mock = abortingFetch(abortError);
    globalThis.fetch = mock.impl;
    const strategy = cappedNative(BASE_URL, { timeoutMs: 5000 });
    const started = startRequest(strategy);
    started.controller.abort();
    expect.hasAssertions();
    await expectNoRetry(started, mock.calls);
  });

  it('does not retry a cancellation that looks like a connect timeout', async () => {
    /**
     * Build the undici connect-timeout rejection.
     * @returns An error whose cause carries the connect-timeout code.
     */
    const connectTimeout = (): Error =>
      new Error('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    const mock = abortingFetch(connectTimeout);
    globalThis.fetch = mock.impl;
    const strategy = cappedNative(BASE_URL, { timeoutMs: 5000 });
    const started = startRequest(strategy);
    started.controller.abort();
    expect.hasAssertions();
    await expectNoRetry(started, mock.calls);
  });
});
