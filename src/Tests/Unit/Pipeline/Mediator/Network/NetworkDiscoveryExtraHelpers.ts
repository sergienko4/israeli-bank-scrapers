/**
 * Shared mock Page + simulate helper for NetworkDiscoveryExtra split test files.
 */

import type { Page, Response } from 'playwright-core';

/** Captured listeners for page.on('response', ...). */
export let listeners: ((r: Response) => boolean)[] = [];

/**
 * Build a mock page that records event listeners and never resolves waits.
 * @param url - Page URL.
 * @returns Mock page.
 */
export function makeMockPage(url = 'https://bank.co.il'): Page {
  listeners = [];
  return {
    /**
     * Record listener.
     * @param event - Event name.
     * @param fn - Listener.
     * @returns Self.
     */
    on: (event: string, fn: (r: Response) => boolean): Page => {
      if (event === 'response') listeners.push(fn);
      return {} as Page;
    },
    /**
     * URL.
     * @returns Configured URL.
     */
    url: (): string => url,
    /**
     * waitForResponse.
     * @returns Never-resolving promise.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * frames.
     * @returns Empty array.
     */
    frames: (): Page[] => [],
    /**
     * evaluate — returns empty string.
     * @returns Resolved 'NONE' by default.
     */
    evaluate: (): Promise<string> => Promise.resolve('NONE'),
  } as unknown as Page;
}

/** Options for simulating a captured response. */
export interface ISimOpts {
  url: string;
  body: Record<string, unknown>;
  method?: string;
  contentType?: string;
  reqHeaders?: Record<string, string>;
  resHeaders?: Record<string, string>;
}

/**
 * Simulate a response event arriving at the discovery listener.
 * @param opts - Response options.
 * @returns Promise settled after async parse.
 */
export async function simulate(opts: ISimOpts): Promise<void> {
  const method = opts.method ?? 'GET';
  const contentType = opts.contentType ?? 'application/json';
  const resp = {
    /**
     * URL accessor.
     * @returns URL.
     */
    url: (): string => opts.url,
    /**
     * Status.
     * @returns 200.
     */
    status: (): number => 200,
    /**
     * Request.
     * @returns Request object.
     */
    request: () => ({
      /**
       * Method.
       * @returns Method.
       */
      method: (): string => method,
      /**
       * postData.
       * @returns Empty.
       */
      postData: (): string => '',
      /**
       * headers.
       * @returns Headers.
       */
      headers: (): Record<string, string> => opts.reqHeaders ?? {},
    }),
    /**
     * Response headers.
     * @returns Headers.
     */
    headers: (): Record<string, string> => ({
      'content-type': contentType,
      ...(opts.resHeaders ?? {}),
    }),
    /**
     * Response text.
     * @returns JSON stringified body.
     */
    text: (): Promise<string> => {
      const bodyJson = JSON.stringify(opts.body);
      return Promise.resolve(bodyJson);
    },
  } as unknown as Response;
  listeners.forEach(fn => {
    fn(resp);
  });
  await Promise.resolve();
  await Promise.resolve();
}
