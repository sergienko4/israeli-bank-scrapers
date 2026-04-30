/**
 * Unit tests for BrowserFetchStrategy — frame matching + empty response branches.
 * Split from BrowserFetchStrategy.test.ts to honor max-lines=300.
 */

import type { Page } from 'playwright-core';

import { createBrowserFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Build TestError with message.
   * @param message - Error message.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Bank config type pulled via IFetchStrategy parameter shape. */
type BankConfigStub = Parameters<
  NonNullable<ReturnType<typeof createBrowserFetchStrategy>['proxyGet']>
>[0];

/** Scripted response for a mocked page.evaluate (POST/GET). */
type EvalTuple = readonly [string, number];

/**
 * Build a Page whose evaluate returns scripted tuples in order, then throws.
 * @param tuples - Responses to return in order.
 * @param urlValue - page.url() return.
 * @param frames - Frames to expose via page.frames().
 * @returns Scripted Page.
 */
function makeScriptedPage(
  tuples: readonly EvalTuple[],
  urlValue = 'https://api.example/',
  frames: Page[] = [],
): Page {
  let idx = 0;
  return {
    /**
     * Page URL stub.
     * @returns Configured URL.
     */
    url: (): string => urlValue,
    /**
     * Frames stub.
     * @returns Configured frames.
     */
    frames: (): Page[] => frames,
    /**
     * Evaluate stub — returns scripted tuples in order.
     * @returns Scripted tuple or rejection when exhausted.
     */
    evaluate: (): Promise<EvalTuple> => {
      if (idx >= tuples.length) return Promise.reject(new Error('no-more-scripted-responses'));
      const current = tuples[idx];
      idx += 1;
      return Promise.resolve(current);
    },
  } as unknown as Page;
}

describe('BrowserFetchStrategy — resolveContext frame matching', () => {
  it('uses page when target origin matches page origin', async () => {
    const page = makeScriptedPage([['{}', 200]], 'https://api.example/');
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.example/data', { extraHeaders: {} });
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });

  it('falls back to page when no frame matches different origin', async () => {
    const page = makeScriptedPage([['{}', 200]], 'https://page.example/');
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
  });

  it('skips frame with about:blank url and falls back', async () => {
    const blankFrame = {
      /**
       * Frame URL stub.
       * @returns about:blank.
       */
      url: (): string => 'about:blank',
      /**
       * Evaluate stub.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => Promise.resolve(['{}', 200] as EvalTuple),
    } as unknown as Page;
    const page = makeScriptedPage([['{}', 200]], 'https://page.example/', [blankFrame]);
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkResult19 = isOk(result);
    expect(isOkResult19).toBe(true);
  });

  it('skips frame with empty url', async () => {
    const emptyFrame = {
      /**
       * Frame URL stub.
       * @returns Empty string.
       */
      url: (): string => '',
      /**
       * Evaluate stub.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => Promise.resolve(['{}', 200] as EvalTuple),
    } as unknown as Page;
    const page = makeScriptedPage([['{}', 200]], 'https://page.example/', [emptyFrame]);
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(true);
  });

  it('uses matching frame when origin aligns', async () => {
    let didMatchFrame = false;
    const apiFrame = {
      /**
       * Frame URL stub.
       * @returns Matching origin URL.
       */
      url: (): string => 'https://api.other.com/inner',
      /**
       * Evaluate stub — records match.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => {
        didMatchFrame = true;
        return Promise.resolve(['{}', 200] as EvalTuple);
      },
    } as unknown as Page;
    const page = makeScriptedPage([['{}', 200]], 'https://page.example/', [apiFrame]);
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(true);
    expect(didMatchFrame).toBe(true);
  });
});

describe('BrowserFetchStrategy — empty response handling', () => {
  it('fetchPost returns empty-response failure when fetch yields empty/null result', async () => {
    const page = makeScriptedPage([['null', 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchPost(
      'https://api.example/x',
      { k: 'v' },
      { extraHeaders: {} },
    );
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(false);
  });

  it('fetchGet-with-headers returns empty-response failure for null body', async () => {
    const page = makeScriptedPage([['null', 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.example/x', {
      extraHeaders: { 'X-Auth': 'xyz' },
    });
    const isOkResult23 = isOk(result);
    expect(isOkResult23).toBe(false);
  });

  it('proxyGet returns empty-response failure on null response body', async () => {
    const page = makeScriptedPage([['null', 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'ReqX', { k: 'v' });
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(false);
  });

  it('proxyGet succeeds when response body is non-null JSON', async () => {
    const page = makeScriptedPage([[JSON.stringify({ data: 'ok' }), 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'ReqX', { k: 'v', a: 'b' });
    const isOkResult25 = isOk(result);
    expect(isOkResult25).toBe(true);
  });
});
