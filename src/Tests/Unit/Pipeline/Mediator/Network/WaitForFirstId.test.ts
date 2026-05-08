/**
 * Phase 7 — `network.waitForFirstId(timeoutMs)` primitive contract.
 *
 * Operates on captures inspected by the same 3-source predicate
 * (`discoverAccountsInPool`) used by ACCOUNT-RESOLVE.POST. Frozen
 * networks are exercised here because `createFrozenNetwork` lets the
 * test pre-seed an immutable pool — no Page mocking needed.
 */

import type { Page } from 'playwright-core';

import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/** Args for `makeCapture`. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
}

/**
 * Build a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: args.postData ?? '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
  };
}

describe('waitForFirstId', () => {
  it('returns the first id-bearing capture immediately when one exists in pool', async () => {
    const idCapture = makeCapture({
      url: 'https://login.hapoalim.example/Authorizations?accountId=12-170-536347',
      method: 'GET',
      responseBody: { ok: true },
    });
    const network = createFrozenNetwork([idCapture], false, false);
    const matched = await network.waitForFirstId(20_000);
    expect(matched).not.toBe(false);
    if (matched !== false) {
      expect(matched.url).toContain('accountId=12-170-536347');
    }
  });

  it('returns false when pool has no id-bearing capture (frozen pool)', async () => {
    const noiseCapture = makeCapture({
      url: 'https://api.bank.example/marketing_banner',
      method: 'GET',
      responseBody: { ok: true },
    });
    const network = createFrozenNetwork([noiseCapture], false, false);
    const matched = await network.waitForFirstId(50);
    expect(matched).toBe(false);
  });

  it('returns false on empty pool (frozen)', async () => {
    const network = createFrozenNetwork([], false, false);
    const matched = await network.waitForFirstId(50);
    expect(matched).toBe(false);
  });

  it('live network: polls and times out when no captures arrive', async () => {
    // Exercises pollFirstId's recursive sleep+retry path: live network
    // starts with empty captures, listener is never invoked, so the
    // poll runs to deadline. Short budget keeps the test fast (one
    // 250 ms tick max).
    const fakePage = {
      /**
       * No-op listener — captures stay empty.
       * @returns Self for chain.
       */
      on: (): Page => ({}) as unknown as Page,
      /**
       * Fire-and-forget POST interceptor — never resolves.
       * @returns Race-of-empty (never settles).
       */
      waitForResponse: (): Promise<false> => Promise.race([]),
    } as unknown as Page;
    const network = createNetworkDiscovery(fakePage);
    const matched = await network.waitForFirstId(300);
    expect(matched).toBe(false);
  });
});
