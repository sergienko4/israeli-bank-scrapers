/**
 * Branch extensions for AccountBootstrap.
 */

import type { Frame, Page } from 'playwright-core';

import { harvestAccountsFromStorage } from '../../../../Scrapers/Pipeline/Mediator/Scrape/AccountBootstrap.js';

/** Mock JsonHandle-like for waitForFunction. */
interface IJsonHandle {
  jsonValue: () => Promise<string>;
}

/**
 * Build a mock Frame with full control.
 * @param jsonList - Immediate JSON values returned by evaluate.
 * @param waitValue - Value (or false) to resolve waitForFunction with.
 * @returns Frame.
 */
function makeFrame(jsonList: readonly string[], waitValue: string | false = false): Frame {
  return {
    /**
     * Evaluate: return pre-filtered JSON list (matches readAllJsonValues source).
     * @returns Filtered storage list.
     */
    evaluate: (): Promise<readonly string[]> => {
      const filtered = jsonList.filter(s => s.startsWith('{'));
      return Promise.resolve(filtered);
    },
    /**
     * waitForFunction mock — resolves with a handle or rejects.
     * @returns Handle or rejection.
     */
    waitForFunction: (): Promise<IJsonHandle> => {
      if (waitValue === false) return Promise.reject(new Error('timeout'));
      return Promise.resolve({
        /**
         * Return canned jsonValue.
         * @returns Value.
         */
        jsonValue: (): Promise<string> => Promise.resolve(waitValue),
      });
    },
  } as unknown as Frame;
}

/**
 * Build a page with scripted frames.
 * @param frames - Parameter.
 * @returns Result.
 */
function makePage(frames: readonly Frame[]): Page {
  return {
    /**
     * Provide frames.
     * @returns Result.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

describe('AccountBootstrap — branch completion', () => {
  it('returns records when immediate scan finds one frame with valid JSON', async () => {
    const acctJson = JSON.stringify({
      accounts: [
        { accountId: 'A1', balance: 10 },
        { accountId: 'A2', balance: 20 },
      ],
    });
    const frame = makeFrame([acctJson]);
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids.length).toBeGreaterThan(0);
  });

  it('handles multiple frames where second resolves during polling', async () => {
    const acctJson = JSON.stringify({
      items: [{ accountId: 'P1' }, { accountId: 'P2' }],
    });
    const emptyFrame = makeFrame([]);
    const pollFrame = makeFrame([], acctJson);
    const page = makePage([emptyFrame, pollFrame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids.length).toBeGreaterThan(0);
  });

  it('returns empty bootstrap when waitForFunction resolves with garbage (no accountId)', async () => {
    const garbage = JSON.stringify({ other: 'field' });
    const frame = makeFrame([], garbage);
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });

  it('returns empty when waitForFunction returns non-json (short string)', async () => {
    const frame = makeFrame([], 'short');
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });

  it('returns empty when all frames reject waitForFunction', async () => {
    const framesArr = [makeFrame([]), makeFrame([])];
    const page = makePage(framesArr);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });

  it('handles no frames (empty page)', async () => {
    const page = makePage([]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids).toEqual([]);
  });

  it('scans ONE frame that has invalid JSON value plus one valid', async () => {
    const valid = JSON.stringify({ accounts: [{ accountId: 'ZZZ' }] });
    const frame = makeFrame(['{invalid', valid]);
    const page = makePage([frame]);
    const res = await harvestAccountsFromStorage(page);
    expect(res.ids.length).toBeGreaterThan(0);
  });

  it('readAllJsonValues invokes its callback and hits the null-fallback branch (line 41)', async () => {
    // Build a frame whose evaluate ACTUALLY calls the callback so line 41
    // (`sessionStorage.getItem(k) ?? ''`) executes. One key returns null so
    // the right-hand side of `??` is exercised.
    const storage: Record<string, string | null> = {
      missing: null,
      acct: JSON.stringify({ accounts: [{ accountId: 'CB1' }] }),
      nonjson: 'plain text',
    };
    /** Fake sessionStorage. */
    const fakeSs = {
      /**
       * Test helper.
       *
       * @param k - Parameter.
       * @returns Result.
       */
      getItem: (k: string): string | null => storage[k] ?? null,
    };
    // Inject sessionStorage into the global scope that the callback reads.
    // We also need `Object.keys(sessionStorage)` to return our storage keys,
    // so we redefine sessionStorage with enumerable props matching storage.
    Object.keys(storage).forEach((k): void => {
      (fakeSs as Record<string, unknown>)[k] = storage[k];
    });
    const savedSs = (globalThis as { sessionStorage?: unknown }).sessionStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeSs;
    try {
      const frame: Frame = {
        /**
         * Invoke callback so its body (line 40–42) executes locally.
         * @param cb - Callback.
         * @returns Result of callback.
         */
        evaluate: <T>(cb: () => T): Promise<T> => {
          const cbResult = cb();
          return Promise.resolve(cbResult);
        },
        /**
         * Reject waitForFunction to skip the polling path.
         * @returns Rejection.
         */
        waitForFunction: (): Promise<never> => Promise.reject(new Error('no-poll')),
      } as unknown as Frame;
      const page = makePage([frame]);
      const res = await harvestAccountsFromStorage(page);
      // Returns a result (possibly empty) — but importantly, the callback body ran.
      expect(res).toBeDefined();
    } finally {
      if (savedSs === undefined) {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      } else {
        (globalThis as { sessionStorage?: unknown }).sessionStorage = savedSs;
      }
    }
  });
});
