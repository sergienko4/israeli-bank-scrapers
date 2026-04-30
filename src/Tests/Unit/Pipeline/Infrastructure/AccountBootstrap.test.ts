/**
 * Unit tests for AccountBootstrap — sessionStorage harvester for account IDs.
 */

import type { Frame, Page } from 'playwright-core';

import { harvestAccountsFromStorage } from '../../../../Scrapers/Pipeline/Mediator/Scrape/AccountBootstrap.js';

/** Handle-shape returned by frame.waitForFunction. */
interface IJsonHandle {
  jsonValue: () => Promise<string>;
}

/**
 * Build a mock Frame with controllable sessionStorage + waitForFunction.
 * @param storage - Map of sessionStorage values to return.
 * @param waitValue - Optional value for waitForFunction poll resolution.
 * @returns Mock Frame.
 */
function makeMockFrame(storage: readonly string[], waitValue: string | false = false): Frame {
  return {
    /**
     * Ignore the callback — return JSON-like storage directly.
     * @returns Storage array pre-filtered to JSON-like entries.
     */
    evaluate: (): Promise<readonly string[]> => {
      const filtered = storage.filter(s => s.startsWith('{'));
      return Promise.resolve(filtered);
    },
    /**
     * Mock waitForFunction — resolves with a handle carrying waitValue.
     * @returns Promise of a JSON handle.
     */
    waitForFunction: (): Promise<IJsonHandle> => {
      if (waitValue === false) return Promise.reject(new Error('timeout'));
      return Promise.resolve({
        /**
         * Return mocked json value.
         * @returns Resolved storage string.
         */
        jsonValue: (): Promise<string> => Promise.resolve(waitValue),
      });
    },
  } as unknown as Frame;
}

/**
 * Build a mock Page exposing frames().
 * @param frames - Array of frame mocks.
 * @returns Mock Page.
 */
function makeMockPage(frames: readonly Frame[]): Page {
  return {
    /**
     * Expose provided frames.
     * @returns Mock frame list.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

describe('harvestAccountsFromStorage', () => {
  it('returns empty bootstrap when no frames have valid JSON', async () => {
    const frame = makeMockFrame([]);
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
    expect(result.records).toEqual([]);
  });

  it('returns ids when a frame carries account-shaped JSON with WK.accountId field', async () => {
    const acctJson = JSON.stringify({
      accounts: [{ accountId: 'ACC123', balance: 100 }],
    });
    const frame = makeMockFrame([acctJson]);
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('skips non-JSON-like values gracefully', async () => {
    const frame = makeMockFrame(['{not valid json']);
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });

  it('handles multiple frames — picks first with account data', async () => {
    const emptyFrame = makeMockFrame([]);
    const acctJson = JSON.stringify({ accountId: 'Z', items: [{ accountId: 'A1' }] });
    const dataFrame = makeMockFrame([acctJson]);
    const page = makeMockPage([emptyFrame, dataFrame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('returns empty bootstrap when evaluate throws', async () => {
    const throwingFrame = {
      /**
       * Throws to simulate broken frame.
       * @returns Rejected promise.
       */
      evaluate: (): Promise<string[]> => Promise.reject(new Error('broken')),
      /**
       * Rejects to simulate timeout.
       * @returns Rejected promise.
       */
      waitForFunction: (): Promise<IJsonHandle> => Promise.reject(new Error('timeout')),
    } as unknown as Frame;
    const page = makeMockPage([throwingFrame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });

  it('falls through to waitForFunction polling when immediate scan is empty', async () => {
    /** Valid JSON arriving on the poll. */
    const acctJson = JSON.stringify({
      accountId: 'ZZ',
      accounts: [{ accountId: 'A1', balance: 1 }],
    });
    const frame = makeMockFrame([], acctJson);
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('returns empty when waitForFunction succeeds but value has no accountId', async () => {
    /** Polling returns a JSON that won't extract any IDs. */
    const garbageJson = JSON.stringify({ foo: 'bar' });
    const frame = makeMockFrame([], garbageJson);
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });

  it('returns empty when immediate scan fails AND polling yields only empty strings', async () => {
    /** Waiter resolves with empty string — filtered out. */
    const frame = makeMockFrame([], '');
    const page = makeMockPage([frame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });

  it('handles mixed frames — one polls successfully, one times out', async () => {
    const acctJson = JSON.stringify({
      accountId: 'X',
      accounts: [{ accountId: 'FROM_POLL' }],
    });
    /** Frame that times out polling. */
    const timeoutFrame = makeMockFrame([]);
    /** Frame that succeeds polling. */
    const pollFrame = makeMockFrame([], acctJson);
    const page = makeMockPage([timeoutFrame, pollFrame]);
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids.length).toBeGreaterThan(0);
  });
});
