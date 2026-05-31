/**
 * Callback-invoking branch coverage for AuthDiscovery.
 * Mocks page.evaluate / frame.evaluate / frame.waitForFunction
 * to actually run the callback bodies with a synthetic sessionStorage,
 * exercising branches inside the browser-side functions.
 */

import type { Frame, JSHandle, Page } from 'playwright-core';

import { discoverAuthThreeTier } from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/** Synthetic sessionStorage data map. */
type StorageMap = Record<string, string>;

/**
 * Install synthetic sessionStorage on globalThis with only data as enumerable.
 * @param map - Key/value map.
 * @returns Restore function.
 */
function installStorage(map: StorageMap): () => boolean {
  const g = globalThis as unknown as { sessionStorage?: unknown };
  const prev = g.sessionStorage;
  const store: Record<string, string> = { ...map };
  Object.defineProperty(store, 'getItem', {
    enumerable: false,
    /**
     * Test helper.
     *
     * @param k - Parameter.
     * @returns Result.
     */
    value: (k: string): string | false => (k in map ? map[k] : false),
  });
  g.sessionStorage = store;
  return (): boolean => {
    g.sessionStorage = prev;
    return true;
  };
}

/** Script for a frame whose evaluate actually invokes callbacks. */
interface IFrameScript {
  readonly storage: StorageMap;
  readonly waitValue?: string;
  readonly waitRejects?: boolean;
}

/**
 * Build a frame whose evaluate/waitForFunction actually invoke the
 * callback body under a synthetic sessionStorage.
 * @param script - Behavior knobs.
 * @returns Mock frame.
 */
function makeCallbackFrame(script: IFrameScript): Frame {
  return {
    /**
     * evaluate: install storage, call fn(arg), restore.
     * @param fn - Callback.
     * @param arg - Optional arg.
     * @returns Callback result.
     */
    evaluate: <T>(fn: (arg?: unknown) => T, arg?: unknown): Promise<T> => {
      const restore = installStorage(script.storage);
      try {
        const fnResult1 = fn(arg);
        return Promise.resolve(fnResult1);
      } finally {
        restore();
      }
    },
    /**
     * waitForFunction: resolve with handle invoking callback under storage.
     * @param fn - Poll callback.
     * @returns Handle or rejection.
     */
    waitForFunction: <T>(fn: () => T): Promise<JSHandle<T>> => {
      if (script.waitRejects) return Promise.reject(new Error('timeout'));
      const restore = installStorage(script.storage);
      try {
        const val = fn();
        return Promise.resolve({
          /**
           * Return scripted wait value or callback result.
           * @returns String value.
           */
          jsonValue: (): Promise<string> => Promise.resolve(script.waitValue ?? String(val ?? '')),
        } as unknown as JSHandle<T>);
      } finally {
        restore();
      }
    },
    /**
     * Frame URL.
     * @returns Canonical URL.
     */
    url: (): string => 'https://frame.bank.co.il/',
  } as unknown as Frame;
}

/**
 * Build a page with scripted frames and main-page storage.
 * @param frames - Frames list.
 * @param pageStorage - Main page storage map.
 * @returns Mock page.
 */
function makeCallbackPage(frames: readonly Frame[], pageStorage: StorageMap = {}): Page {
  return {
    /**
     * Page evaluate: install main-page storage then run.
     * @param fn - Callback.
     * @param arg - Arg.
     * @returns Result.
     */
    evaluate: <T>(fn: (arg?: unknown) => T, arg?: unknown): Promise<T> => {
      const restore = installStorage(pageStorage);
      try {
        const fnResult2 = fn(arg);
        return Promise.resolve(fnResult2);
      } finally {
        restore();
      }
    },
    /**
     * frames.
     * @returns Frames.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

const NO_EPS: IDiscoveredEndpoint[] = [];

describe('AuthDiscovery — callback invocation branches', () => {
  it('main-page evaluate: finds storage value via keys.map + .find(Boolean)', async () => {
    const page = makeCallbackPage([], {
      token: 'direct-token-abcdefghijklmno',
      auth: '',
    });
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(typeof token).toBe('string');
  });

  it('main-page evaluate: all values empty → callback returns NONE', async () => {
    const page = makeCallbackPage([], { auth: '', token: '' });
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(token).toBe(false);
  });

  it('main-page evaluate: getItem returns null (key absent) → "" via ?? ""', async () => {
    // No keys in map at all — getItem returns null, ?? '' kicks in
    const page = makeCallbackPage([], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(token).toBe(false);
  });

  it('frame readFrameStorage callback: keys.map + find branch both-sides', async () => {
    const authJson = JSON.stringify({ auth: { token: 'frame-token-xyz-a7f4b2c8d3e9' } });
    const frame = makeCallbackFrame({ storage: { auth: authJson } });
    const page = makeCallbackPage([frame], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(typeof token).toBe('string');
  });

  it('dumpFrameKeys: Object.keys returns list OR EMPTY fallback', async () => {
    // Force empty keys via strict empty storage
    const frame = makeCallbackFrame({ storage: {} });
    const page = makeCallbackPage([frame], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(token).toBe(false);
  });

  it('readAllJsonStorageValues callback: filter only {-starting values', async () => {
    const authJson = JSON.stringify({ auth: { token: 'scan-all-key-token-1234567' } });
    // Storage contains JSON-like AND non-JSON entries — filter should keep only JSON
    const frame = makeCallbackFrame({
      storage: {
        weird: 'no-json-here',
        good: authJson,
        blank: '',
      },
    });
    const page = makeCallbackPage([frame], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(typeof token).toBe('string');
  });

  it('waitForFunction callback: sessionStorage.getItem("auth-module") ?? "" empty branch', async () => {
    const frame = makeCallbackFrame({
      storage: {}, // no auth-module key → null → '' via ??
      waitValue: '', // handle resolves to empty
    });
    const page = makeCallbackPage([frame], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(token).toBe(false);
  });

  it('waitForFunction callback: auth-module present → returned as is', async () => {
    const authJson = JSON.stringify({ auth: { calConnectToken: 'poll-token-abcdefghij' } });
    const frame = makeCallbackFrame({
      storage: { 'auth-module': authJson },
      waitValue: authJson,
    });
    const page = makeCallbackPage([frame], {});
    const token = await discoverAuthThreeTier(NO_EPS, page);
    expect(typeof token).toBe('string');
  });
});
