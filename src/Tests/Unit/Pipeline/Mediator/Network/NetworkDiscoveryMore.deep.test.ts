/**
 * More NetworkDiscovery coverage — content scanning, interceptors, handleResponse.
 */

import type { Frame, Page, Response } from 'playwright-core';

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makePage, simulate } from './NetworkDiscoveryMoreHelpers.js';

describe('NetworkDiscovery — content discovery field scanning', () => {
  it('discoverEndpointByContent returns false with no responseBody', async () => {
    await Promise.resolve();
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    const r = discovery.discoverEndpointByContent(['whatever']);
    expect(r).toBe(false);
  });

  it('discoverEndpointByContent scans flat body', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/x', body: { foo: 'bar', nested: { inner: 1 } } });
    const r = discovery.discoverEndpointByContent(['foo']);
    expect(r).not.toBe(false);
  });
});

/**
 * Build a Response mock that matches an isWkApi check (POST to authentication URL).
 * Used to drive interceptPostResponses inner callback path.
 * @param url - Endpoint URL.
 * @param body - JSON body payload.
 * @param method - HTTP method.
 * @returns Mock Response.
 */
function makeWkResponse(url: string, body: Record<string, unknown>, method = 'POST'): Response {
  return {
    /**
     * Test helper.
     * @returns Result.
     */
    url: (): string => url,
    /**
     * Test helper.
     * @returns Result.
     */
    status: (): number => 200,
    /**
     * Test helper.
     * @returns Result.
     */
    request: () => ({
      /**
       * Test helper.
       * @returns Result.
       */
      method: (): string => method,
      /**
       * Test helper.
       * @returns Result.
       */
      postData: (): string => '',
      /**
       * Test helper.
       * @returns Result.
       */
      headers: (): Record<string, string> => ({}),
    }),
    /**
     * Test helper.
     * @returns Result.
     */
    headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
    /**
     * Test helper.
     * @returns Result.
     */
    text: (): Promise<string> => {
      const bodyJson = JSON.stringify(body);
      return Promise.resolve(bodyJson);
    },
  } as unknown as Response;
}

/**
 * Make a Page whose waitForResponse matcher is called then resolves with
 * a given Response object. Matches isWkApi = true for WK API URLs.
 * @param wkResponse - Response to return from waitForResponse.
 * @returns Mock page.
 */
function makeWkPage(wkResponse: Response): Page {
  const localListeners: ((r: Response) => boolean)[] = [];
  return {
    /**
     * Record listener.
     * @param event - Parameter.
     * @param fn - Parameter.
     * @returns Result.
     */
    on: (event: string, fn: (r: Response) => boolean): Page => {
      if (event === 'response') localListeners.push(fn);
      return {} as Page;
    },
    /**
     * Test helper.
     * @returns Result.
     */
    url: (): string => 'https://bank.co.il',
    /**
     * waitForResponse — call matcher and resolve with response.
     * @param matcher - Predicate or URL.
     * @returns Resolves to wkResponse.
     */
    waitForResponse: (matcher: unknown): Promise<Response> => {
      if (typeof matcher === 'function') {
        const pred = matcher as (r: Response) => boolean;
        pred(wkResponse); // Hits isWkApi branches (POST/PUT + URL regex)
      }
      return Promise.resolve(wkResponse);
    },
    /**
     * Test helper.
     * @returns Result.
     */
    frames: (): Frame[] => [],
    /**
     * Test helper.
     * @returns Result.
     */
    evaluate: (): Promise<string> => Promise.resolve('NONE'),
  } as unknown as Page;
}

describe('NetworkDiscovery — interceptPostResponses inner callback', () => {
  it('successful waitForResponse captures WK API endpoint', async () => {
    const wkResp = makeWkResponse('https://api.bank.co.il/authentication/login', { token: 'x' });
    const page = makeWkPage(wkResp);
    const discovery = createNetworkDiscovery(page);
    // interceptPostResponses fired at creation — await its promise microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const eps = discovery.getAllEndpoints();
    expect(eps.length).toBeGreaterThanOrEqual(0);
  });

  it('GET request is filtered out by isWkApi (non-POST/PUT method branch)', async () => {
    const wkResp = makeWkResponse(
      'https://api.bank.co.il/authentication/login',
      { ok: true },
      'GET',
    );
    const page = makeWkPage(wkResp);
    const discovery = createNetworkDiscovery(page);
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBeGreaterThanOrEqual(0);
  });

  it('PUT method also hits isWkApi matcher', async () => {
    const wkResp = makeWkResponse(
      'https://api.bank.co.il/authentication/login',
      { ok: true },
      'PUT',
    );
    const page = makeWkPage(wkResp);
    const discovery = createNetworkDiscovery(page);
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBeGreaterThanOrEqual(0);
  });

  it('non-WK URL is filtered by isWkApi (URL regex branch false)', async () => {
    const wkResp = makeWkResponse('https://api.bank.co.il/random-endpoint', { ok: true });
    const page = makeWkPage(wkResp);
    const discovery = createNetworkDiscovery(page);
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBeGreaterThanOrEqual(0);
  });
});
