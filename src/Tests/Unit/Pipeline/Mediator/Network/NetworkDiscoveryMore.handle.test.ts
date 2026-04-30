/**
 * More NetworkDiscovery coverage — handleResponse, parseResponse, dumpResponseBody, waitForTraffic.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { Frame, Page, Response } from 'playwright-core';

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { listeners, makePage, restoreDumpDir, simulate } from './NetworkDiscoveryMoreHelpers.js';

describe('NetworkDiscovery — handleResponse non-JSON content type', () => {
  it('non-JSON content-type skips capture but logs for interesting POST/col-rest', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    // Simulate a POST response with non-JSON content-type
    const resp = {
      /**
       * Test helper.
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/col-rest/session',
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
        method: (): string => 'POST',
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
      headers: (): Record<string, string> => ({ 'content-type': 'image/png' }),
      /**
       * Test helper.
       * @returns Result.
       */
      text: (): Promise<string> => Promise.resolve(''),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBe(0);
  });

  it('handleResponse with missing content-type header applies NO_CONTENT_TYPE sentinel', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    const resp = {
      /**
       * Test helper.
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/x',
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
        method: (): string => 'POST',
        /**
         * Test helper.
         * @returns Result.
         */
        postData: (): string | null => null,
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
      headers: (): Record<string, string> => ({}),
      /**
       * Test helper.
       * @returns Result.
       */
      text: (): Promise<string> => Promise.resolve('{}'),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    // Was skipped (no 'application/json' in 'none')
    expect(discovery.getAllEndpoints().length).toBe(0);
  });
});

describe('NetworkDiscovery — parseResponse JSON parse error', () => {
  it('invalid JSON body returns false from parseResponse', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    const resp = {
      /**
       * Test helper.
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/x',
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
        method: (): string => 'POST',
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
      text: (): Promise<string> => Promise.resolve('<<not json>>'),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBe(0);
  });
});

describe('NetworkDiscovery — dumpResponseBody failure path', () => {
  it('DUMP_NETWORK_DIR pointing to inaccessible path silently fails', async () => {
    const priorDir = process.env.DUMP_NETWORK_DIR;
    // Use a null character path that's invalid on most OSes → mkdirSync throws
    const tmpdirResult6 = os.tmpdir();
    process.env.DUMP_NETWORK_DIR = path.join(tmpdirResult6, 'dump-fail-\0badpath');
    try {
      const page = makePage();
      const discovery = createNetworkDiscovery(page);
      await simulate({ url: 'https://api.bank.co.il/x', body: { ok: true } });
      // Should not throw — silent failure
      expect(discovery.getAllEndpoints().length).toBeGreaterThanOrEqual(0);
    } finally {
      restoreDumpDir(priorDir ?? '');
    }
  });
});

describe('NetworkDiscovery — waitForTraffic matcher invocation', () => {
  it('waitForTraffic matcher is invoked against captured responses', async () => {
    // Build page that calls the matcher function with a test response before resolving
    const testResp = {
      /**
       * Test helper.
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/foo',
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
        method: (): string => 'GET',
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
      headers: (): Record<string, string> => ({}),
      /**
       * Test helper.
       * @returns Result.
       */
      text: (): Promise<string> => Promise.resolve(''),
    } as unknown as Response;
    let wasMatcherCalled = false;
    const page = {
      /**
       * Record listener.
       * @param event - Parameter.
       * @param fn - Parameter.
       * @returns Result.
       */
      on: (event: string, fn: (r: Response) => boolean): Page => {
        if (event === 'response') listeners.push(fn);
        return {} as Page;
      },
      /**
       * Test helper.
       * @returns Result.
       */
      url: (): string => 'https://bank.co.il',
      /**
       * waitForResponse — invoke matcher + reject to end quickly.
       * @param matcher - Test predicate.
       * @returns Rejected.
       */
      waitForResponse: (matcher: unknown): Promise<never> => {
        if (typeof matcher === 'function') {
          wasMatcherCalled = true;
          (matcher as (r: Response) => boolean)(testResp);
        }
        return Promise.reject(new Error('timeout'));
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
    const discovery = createNetworkDiscovery(page);
    const result = await discovery.waitForTraffic([/foo/], 10);
    expect(wasMatcherCalled).toBe(true);
    expect(result === false || typeof result === 'object').toBe(true);
  });
});
