/**
 * NetworkDiscoveryExtra — parseResponse branches (split).
 */

import type { Response } from 'playwright-core';

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { listeners, makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — parseResponse branches', () => {
  it('ignores non-JSON content types', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/a.html',
      body: {},
      contentType: 'image/png',
    });
    // content-type not JSON → parseResponse returns false → not captured.
    expect(discovery.getAllEndpoints().length).toBe(0);
  });

  it('accepts text/html content type when body parses as JSON', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/mixed',
      body: { token: 'abc' },
      contentType: 'text/html; charset=UTF-8',
    });
    expect(discovery.getAllEndpoints().length).toBe(1);
  });

  it('handles text/plain content type', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/plain',
      body: { x: 1 },
      contentType: 'text/plain',
    });
    expect(discovery.getAllEndpoints().length).toBe(1);
  });

  it('handles missing content-type header (uses NO_CONTENT_TYPE sentinel)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Construct a response without content-type in headers:
    const resp = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/x',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      status: (): number => 200,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      request: () => ({
        /**
         * Test helper.
         *
         * @returns Result.
         */
        method: (): string => 'GET',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        postData: (): string => '',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        headers: (): Record<string, string> => ({}),
      }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      headers: (): Record<string, string> => ({}),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      text: (): Promise<string> => Promise.resolve('{}'),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    // Without content-type the sentinel 'none' is not JSON → not captured.
    expect(discovery.getAllEndpoints().length).toBe(0);
  });

  it('silently discards bodies that cannot be JSON-parsed', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const resp = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/broken',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      status: (): number => 200,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      request: () => ({
        /**
         * Test helper.
         *
         * @returns Result.
         */
        method: (): string => 'POST',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        postData: (): string => '',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        headers: (): Record<string, string> => ({}),
      }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      text: (): Promise<string> => Promise.resolve('not-valid-json{{'),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBe(0);
  });

  it('ignores failing response.text() gracefully', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const resp = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'https://api.bank.co.il/fail',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      status: (): number => 200,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      request: () => ({
        /**
         * Test helper.
         *
         * @returns Result.
         */
        method: (): string => 'GET',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        postData: (): string => '',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        headers: (): Record<string, string> => ({}),
      }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      text: (): Promise<string> => Promise.reject(new Error('text-fail')),
    } as unknown as Response;
    listeners.forEach(fn => {
      fn(resp);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(discovery.getAllEndpoints().length).toBe(0);
  });

  it('captures POST methods (isInteresting branch, logs but still discards non-JSON)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/post',
      body: {},
      method: 'POST',
      contentType: 'text/plain',
    });
    expect(discovery.getAllEndpoints().length).toBe(1);
  });

  it('captures col-rest endpoints (isInteresting branch)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/col-rest/events',
      body: {},
      method: 'GET',
      contentType: 'application/octet-stream',
    });
    // Content-type is not JSON → parseResponse returns false but URL contains /col-rest/
    // → the isInteresting branch at line 215 logs trace. Endpoint is NOT captured.
    expect(discovery.getAllEndpoints().length).toBe(0);
  });
});
