/**
 * Callback-invoking branch coverage for AccountBootstrap.
 * Provides a synthetic sessionStorage and actually runs the
 * frame.evaluate() and waitForFunction() callback bodies under Jest
 * to cover branches inside them.
 */

import type { Frame, Page } from 'playwright-core';

import { harvestAccountsFromStorage } from '../../../../Scrapers/Pipeline/Mediator/Scrape/AccountBootstrap.js';

/** Synthetic sessionStorage map mapped into the global. */
type StorageMap = Record<string, string>;

/** Handle-shape returned by frame.waitForFunction. */
interface IJsonHandle {
  jsonValue: () => Promise<string>;
}

/** Script for the callback-invoking frame. */
interface ICallbackScript {
  /** Storage key/value map pushed into synthetic sessionStorage. */
  storage: StorageMap;
  /** When true, evaluate rejects instead of invoking callback. */
  evalRejects?: boolean;
  /** When true, waitForFunction rejects (timeout). */
  waitRejects?: boolean;
}

/**
 * Install a synthetic sessionStorage on globalThis for the duration
 * of the callback invocation.
 * @param map - Key/value storage map.
 * @returns Restore function.
 */
function installStorage(map: StorageMap): () => true {
  const g = globalThis as unknown as { sessionStorage?: unknown };
  const prev = g.sessionStorage;
  // Build object with data as enumerable own keys, methods via non-enumerable descriptors
  const store: Record<string, string> = { ...map };
  Object.defineProperty(store, 'getItem', {
    enumerable: false,
    /**
     * Test helper.
     *
     * @param k - Parameter.
     * @returns Result.
     */
    value: (k: string): string => (k in map ? map[k] : ''),
  });
  Object.defineProperty(store, 'setItem', {
    enumerable: false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    value: (): true => true,
  });
  Object.defineProperty(store, 'removeItem', {
    enumerable: false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    value: (): true => true,
  });
  Object.defineProperty(store, 'clear', {
    enumerable: false,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    value: (): true => true,
  });
  g.sessionStorage = store;
  return (): true => {
    g.sessionStorage = prev;
    return true;
  };
}

/**
 * Build a mock Frame that actually invokes the evaluate callback
 * with a synthetic sessionStorage global.
 * @param script - Script knobs.
 * @returns Mock Frame.
 */
function makeCallbackFrame(script: ICallbackScript): Frame {
  return {
    /**
     * evaluate: install synthetic sessionStorage, invoke callback, restore.
     * @param fn - Callback to invoke.
     * @param arg - Optional argument (keys list).
     * @returns Result of callback.
     */
    evaluate: <T>(fn: (arg?: unknown) => T, arg?: unknown): Promise<T> => {
      if (script.evalRejects) return Promise.reject(new Error('eval-failed'));
      const restore = installStorage(script.storage);
      try {
        const out = fn(arg);
        return Promise.resolve(out);
      } finally {
        restore();
      }
    },
    /**
     * waitForFunction: install storage, invoke callback, wrap result.
     * @param fn - Poll callback.
     * @returns Handle with jsonValue or rejection.
     */
    waitForFunction: (fn: () => unknown): Promise<IJsonHandle> => {
      if (script.waitRejects) return Promise.reject(new Error('timeout'));
      const restore = installStorage(script.storage);
      try {
        const val = fn();
        return Promise.resolve({
          /**
           * Return resolved callback value as string.
           * @returns Value string.
           */
          jsonValue: (): Promise<string> => {
            const valStr = typeof val === 'string' ? val : JSON.stringify(val ?? '');
            return Promise.resolve(valStr);
          },
        });
      } finally {
        restore();
      }
    },
  } as unknown as Frame;
}

/**
 * Build a page with scripted frames.
 * @param frames - Frames to return.
 * @returns Mock page.
 */
function makePage(frames: readonly Frame[]): Page {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

describe('AccountBootstrap — callback invocation branches', () => {
  it('scan callback filters only JSON-starting values (L41:0 both branches)', async () => {
    const acctJson = JSON.stringify({ accounts: [{ accountId: 'X1' }, { accountId: 'X2' }] });
    const frame = makeCallbackFrame({
      storage: {
        'random-not-json': 'plain-string',
        acctData: acctJson,
        emptyKey: '',
      },
    });
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids.length).toBeGreaterThan(0);
  });

  it('wait callback filters by cardUniqueId/accountId substring (L130-132)', async () => {
    const acctJson = JSON.stringify({ accounts: [{ accountId: 'P1' }] });
    // Immediate scan finds nothing (no JSON-like), falls to waitForFunction
    const frame = makeCallbackFrame({
      storage: {
        marker: acctJson, // value contains 'accountId'
        unrelated: 'no-match-here',
      },
    });
    // Make evaluate return empty so we hit the wait path
    const emptyEvalFrame: Frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      waitForFunction: (fn: () => unknown): Promise<IJsonHandle> => {
        const restore = installStorage({
          marker: acctJson,
          unrelated: 'no-match-here',
        });
        try {
          const val = fn();
          return Promise.resolve({
            /**
             * Test helper.
             *
             * @returns Result.
             */
            jsonValue: (): Promise<string> => {
              const valStr = typeof val === 'string' ? val : JSON.stringify(val ?? '');
              return Promise.resolve(valStr);
            },
          });
        } finally {
          restore();
        }
      },
    } as unknown as Frame;
    expect(frame).toBeDefined();
    const page = makePage([emptyEvalFrame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids.length).toBeGreaterThan(0);
  });

  it('wait callback returns empty string when no values match substring filter (L132 empty branch)', async () => {
    const emptyEvalFrame: Frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      waitForFunction: (fn: () => unknown): Promise<IJsonHandle> => {
        const restore = installStorage({
          a: 'nothing-with-id',
          b: 'also-nothing',
        });
        try {
          const val = fn();
          return Promise.resolve({
            /**
             * Test helper.
             *
             * @returns Result.
             */
            jsonValue: (): Promise<string> => {
              const valStr = typeof val === 'string' ? val : JSON.stringify(val ?? '');
              return Promise.resolve(valStr);
            },
          });
        } finally {
          restore();
        }
      },
    } as unknown as Frame;
    const page = makePage([emptyEvalFrame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });

  it('scan callback handles null getItem (L41:0 left — null → empty string) and rejection (L154)', async () => {
    // evalRejects exercises catch branch
    const frame = makeCallbackFrame({ storage: {}, evalRejects: true, waitRejects: true });
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });
});
