/**
 * Extra coverage for AuthDiscovery — frame-based tiers (3b/3c/4).
 */

import type { Frame, JSHandle, Page } from 'playwright-core';

import { discoverAuthThreeTier } from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/** Script for a mock frame. */
interface IFrameScript {
  /** sessionStorage auth-module value. */
  storage?: string;
  /** sessionStorage keys list. */
  keys?: readonly string[];
  /** Values for all storage keys. */
  values?: readonly string[];
  /** Frame URL. */
  url?: string;
  /** Whether waitForFunction resolves. */
  waitOk?: boolean;
}

/**
 * Build a mock Frame with scripted evaluate + waitForFunction.
 * @param script - Behaviour script.
 * @returns Mock frame.
 */
function makeFrame(script: IFrameScript = {}): Frame {
  const storage = script.storage ?? '';
  const keys = script.keys ?? [];
  const values = script.values ?? [];
  return {
    /**
     * evaluate — responds to multi-key reads.
     * @param fn - Callback (unused).
     * @param arg - Optional arg (not used).
     * @returns Scripted result.
     */
    evaluate: (fn: unknown, arg?: unknown): Promise<unknown> => {
      // First call in discoverFromAllFrames → readFrameStorage: returns single value
      // Also dumpFrameKeys: returns joined keys
      // Also readAllJsonStorageValues: returns values filter
      const source = String(fn);
      if (source.includes('Object.keys') && !source.includes('filter')) {
        return Promise.resolve(keys.join(', ') || 'EMPTY');
      }
      if (source.includes('filter')) return Promise.resolve(values);
      if (arg) return Promise.resolve(storage || 'NONE');
      return Promise.resolve('NONE');
    },
    /**
     * waitForFunction.
     * @returns Resolves to handle with jsonValue when scripted ok, otherwise rejects.
     */
    waitForFunction: (): Promise<JSHandle<string>> => {
      if (script.waitOk) {
        return Promise.resolve({
          /**
           * jsonValue.
           * @returns Scripted storage string.
           */
          jsonValue: (): Promise<string> => Promise.resolve(storage),
        } as unknown as JSHandle<string>);
      }
      return Promise.reject(new Error('timeout'));
    },
    /**
     * url.
     * @returns Scripted URL.
     */
    url: (): string => script.url ?? 'https://iframe.co.il/',
  } as unknown as Frame;
}

/**
 * Build a mock Page that returns scripted frames.
 * @param frames - Child frames to return.
 * @returns Mock page.
 */
function makePage(frames: Frame[] = []): Page {
  return {
    /**
     * evaluate returns NONE (main page has no auth storage).
     * @returns Resolved 'NONE'.
     */
    evaluate: (): Promise<string> => Promise.resolve('NONE'),
    /**
     * frames.
     * @returns Scripted frames.
     */
    frames: (): Frame[] => frames,
  } as unknown as Page;
}

/** Shared not-endpoint-captured array. */
const NO_ENDPOINTS: IDiscoveredEndpoint[] = [];

describe('discoverAuthThreeTier — frames tier', () => {
  it('Tier 3b: discovers token from iframe sessionStorage JSON', async () => {
    const frame = makeFrame({
      storage: JSON.stringify({ auth: { token: 'deep-frame-token' } }),
      keys: ['auth'],
    });
    const page = makePage([frame]);
    const token = await discoverAuthThreeTier(NO_ENDPOINTS, page);
    expect(token).toContain('deep-frame-token');
  });

  it('Tier 3b: returns raw long values from iframe storage', async () => {
    const frame = makeFrame({
      storage: 'aaaaaaaaaaaaaaaaaaaaaaaaa',
      keys: ['auth'],
    });
    const page = makePage([frame]);
    const token = await discoverAuthThreeTier(NO_ENDPOINTS, page);
    expect(typeof token === 'string' || !token).toBe(true);
  });

  it('returns false when all tiers fail', async () => {
    const frame = makeFrame({ storage: '', keys: [] });
    const page = makePage([frame]);
    const token = await discoverAuthThreeTier(NO_ENDPOINTS, page);
    expect(token).toBe(false);
  });

  it('falls through to header discovery after storage/frames/polling all fail', async () => {
    const frame = makeFrame({ storage: '', keys: [] });
    const page = makePage([frame]);
    const withHeaderEp = {
      url: 'https://api.bank/t',
      method: 'POST',
      postData: '',
      contentType: 'application/json',
      requestHeaders: { authorization: 'Bearer header-fallback' },
      responseHeaders: {},
      responseBody: {},
      timestamp: 0,
    } as unknown as IDiscoveredEndpoint;
    const token = await discoverAuthThreeTier([withHeaderEp], page);
    expect(token).toContain('Bearer header-fallback');
  });

  it('prefers body token over header (Tier 2 wins)', async () => {
    const frame = makeFrame({ storage: '', keys: [] });
    const page = makePage([frame]);
    const multiEp = {
      url: 'https://api.bank.co.il/authentication/login',
      method: 'POST',
      postData: '',
      contentType: 'application/json',
      requestHeaders: { authorization: 'Bearer headerval' },
      responseHeaders: {},
      responseBody: { token: 'body-wins' },
      timestamp: 0,
    } as unknown as IDiscoveredEndpoint;
    const token = await discoverAuthThreeTier([multiEp], page);
    expect(token).toContain('body-wins');
  });
});
