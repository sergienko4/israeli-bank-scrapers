/**
 * Callback-invoking branch coverage for Fetch inner evaluate callbacks.
 * Mocks page.evaluate to actually invoke the inner fetch callback
 * under a synthetic global fetch, hitting `response.status === 204` branches.
 */

import type { Page } from 'playwright-core';

import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch.js';

/** Response script for synthetic fetch. */
interface IFetchResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Install a synthetic global fetch returning scripted responses.
 * @param script - Response script.
 * @returns Restore function.
 */
function installFetch(script: IFetchResponse): () => boolean {
  const g = globalThis as unknown as { fetch?: unknown };
  const prev = g.fetch;
  /**
   * Test helper.
   *
   * @returns Result.
   */
  g.fetch = (): Promise<unknown> =>
    Promise.resolve({
      status: script.status,
      /**
       * Return scripted body text.
       * @returns Body.
       */
      text: (): Promise<string> => Promise.resolve(script.body),
    });
  return (): boolean => {
    g.fetch = prev;
    return true;
  };
}

/**
 * Build a page that invokes the fetch callback with a synthetic global fetch.
 * @param script - Fetch response script.
 * @returns Mock page.
 */
function makeCallbackPage(script: IFetchResponse): Page {
  return {
    /**
     * Invoke fn(arg) under synthetic fetch.
     * @param fn - Inner callback (async).
     * @param arg - Argument (url or combined obj).
     * @returns Callback promise.
     */
    evaluate: <T>(fn: (arg?: unknown) => Promise<T> | T, arg?: unknown): Promise<T> => {
      const restore = installFetch(script);
      const fnResult1 = fn(arg);
      return Promise.resolve(fnResult1).finally((): boolean => {
        restore();
        return true;
      });
    },
  } as unknown as Page;
}

describe('Fetch — callback invocation branches', () => {
  it('evaluateGet callback: status 204 returns ["", 204] tuple', async () => {
    const page = makeCallbackPage({ status: 204, body: '' });
    const result = await fetchGetWithinPage<Record<string, unknown>>(page, 'https://api/x', true);
    expect(result).toEqual({});
  });

  it('evaluateGet callback: status 200 returns [body, status] tuple', async () => {
    const page = makeCallbackPage({ status: 200, body: '{"a":1}' });
    const result = await fetchGetWithinPage<Record<string, unknown>>(page, 'https://api/x', true);
    expect(result).toEqual({ a: 1 });
  });

  it('evaluateGetWithHeaders callback: status 204 returns [""], 204 branch', async () => {
    const page = makeCallbackPage({ status: 204, body: '' });
    const result = await fetchGetWithinPageWithHeaders<Record<string, unknown>>(
      page,
      'https://api/x',
      { Authorization: 'Bearer t' },
    );
    expect(result).toEqual({});
  });

  it('evaluateGetWithHeaders callback: status 200 returns body tuple', async () => {
    const page = makeCallbackPage({ status: 200, body: '{"ok":true}' });
    const result = await fetchGetWithinPageWithHeaders<Record<string, unknown>>(
      page,
      'https://api/x',
      { Authorization: 'Bearer t' },
    );
    expect(result).toEqual({ ok: true });
  });

  it('doPostFetch callback: status 204 returns ["", 204] branch', async () => {
    const page = makeCallbackPage({ status: 204, body: '' });
    const result = await fetchPostWithinPage<Record<string, unknown>>(page, 'https://api/x', {
      data: {},
      shouldIgnoreErrors: true,
    });
    expect(result).toEqual({});
  });

  it('doPostFetch callback: status 200 returns text + status', async () => {
    const page = makeCallbackPage({ status: 200, body: '{"posted":1}' });
    const result = await fetchPostWithinPage<Record<string, unknown>>(page, 'https://api/x', {
      data: { x: 1 },
    });
    expect(result).toEqual({ posted: 1 });
  });
});
