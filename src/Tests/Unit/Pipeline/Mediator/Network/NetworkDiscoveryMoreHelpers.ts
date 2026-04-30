/**
 * Shared mock Page + simulate helper for NetworkDiscoveryMore split test files.
 */

import type { Frame, Page, Response } from 'playwright-core';

/** Captured listeners. */
export let listeners: ((r: Response) => boolean)[] = [];

/**
 * Build a mock page with optional frames.
 * @param frames - Frames to return.
 * @param url - Page URL.
 * @returns Mock page.
 */
export function makePage(frames: Frame[] = [], url = 'https://bank.co.il'): Page {
  listeners = [];
  return {
    /**
     * on.
     * @param event - Event name.
     * @param fn - Listener.
     * @returns Self.
     */
    on: (event: string, fn: (r: Response) => boolean): Page => {
      if (event === 'response') listeners.push(fn);
      return {} as Page;
    },
    /**
     * url.
     * @returns URL.
     */
    url: (): string => url,
    /**
     * waitForResponse — rejects quickly for test purposes.
     * @returns Rejected promise.
     */
    waitForResponse: (): Promise<false> => Promise.reject(new Error('timeout')),
    /**
     * frames.
     * @returns Frames array.
     */
    frames: (): Frame[] => frames,
    /**
     * evaluate — returns NONE sentinel.
     * @returns Resolved.
     */
    evaluate: (): Promise<string> => Promise.resolve('NONE'),
  } as unknown as Page;
}

/** Options for the `simulate` helper. */
export interface ISimOpts {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly reqHeaders?: Record<string, string>;
  readonly resHeaders?: Record<string, string>;
  readonly method?: string;
}

/**
 * Simulate a captured response to the page's listener.
 * @param opts - Simulation options.
 * @returns Resolves after two microtasks.
 */
export async function simulate(opts: ISimOpts): Promise<boolean> {
  const { url, body } = opts;
  const reqHeaders = opts.reqHeaders ?? {};
  const resHeaders = opts.resHeaders ?? {};
  const method = opts.method ?? 'POST';
  const response = {
    /**
     * URL.
     * @returns URL.
     */
    url: (): string => url,
    /**
     * Status.
     * @returns 200.
     */
    status: (): number => 200,
    /**
     * Request.
     * @returns Request.
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
       * Headers.
       * @returns Request headers.
       */
      headers: (): Record<string, string> => reqHeaders,
    }),
    /**
     * headers.
     * @returns Response headers.
     */
    headers: (): Record<string, string> => ({
      'content-type': 'application/json',
      ...resHeaders,
    }),
    /**
     * text.
     * @returns JSON body.
     */
    text: (): Promise<string> => {
      const bodyJson = JSON.stringify(body);
      return Promise.resolve(bodyJson);
    },
  } as unknown as Response;
  listeners.forEach(fn => {
    fn(response);
  });
  await Promise.resolve();
  await Promise.resolve();
  return true;
}

/**
 * Restore DUMP_NETWORK_DIR env var after test.
 * @param prior - Original value (empty string means unset).
 * @returns true after applying.
 */
export function restoreDumpDir(prior: string): boolean {
  if (prior === '') delete process.env.DUMP_NETWORK_DIR;
  else process.env.DUMP_NETWORK_DIR = prior;
  return true;
}
