/**
 * Coverage for the dashboard-click bucketing primitives —
 * `markDashboardClickAt`, `getDashboardClickAt`, `getPreNavCaptures`,
 * `getPostNavCaptures` (with soft-fallback), and the post-nav-aware
 * override of `discoverTransactionsEndpoint`. Live + frozen variants.
 */

import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { makePage, simulate } from './NetworkDiscoveryMoreHelpers.js';

/**
 * Build a synthetic discovered endpoint with a forced timestamp.
 * @param url - URL to assign.
 * @param timestamp - Capture timestamp in ms-since-epoch.
 * @param method - Optional HTTP method (defaults to GET).
 * @returns Synthetic endpoint.
 */
function makeEndpoint(
  url: string,
  timestamp: number,
  method: 'GET' | 'POST' = 'GET',
): IDiscoveredEndpoint {
  return {
    url,
    method,
    postData: '',
    responseBody: { transactions: [] },
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp,
  };
}

describe('NetworkDiscovery — dashboard-click bucketing (live)', () => {
  it('markDashboardClickAt + getDashboardClickAt round-trip', () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    const isMarked = discovery.markDashboardClickAt(12345);
    const value = discovery.getDashboardClickAt();
    expect(isMarked).toBe(true);
    expect(value).toBe(12345);
  });

  it('getDashboardClickAt returns false before any mark', () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    const value = discovery.getDashboardClickAt();
    expect(value).toBe(false);
  });

  it('getPreNavCaptures returns full pool when no click marked', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://x.example/api/a', body: { ok: true } });
    const pre = discovery.getPreNavCaptures();
    expect(pre.length).toBeGreaterThanOrEqual(1);
  });

  it('getPostNavCaptures widens to full pool when no click marked (Visacal-class banks)', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://x.example/api/a', body: { ok: true } });
    const post = discovery.getPostNavCaptures();
    expect(post.length).toBeGreaterThanOrEqual(1);
  });
});

describe('NetworkDiscovery — collection gate', () => {
  it('records captures by default (gate ON at construction)', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://x.example/api/active', body: { ok: true } });
    const eps = discovery.getAllEndpoints();
    expect(eps.length).toBeGreaterThanOrEqual(1);
  });

  it('drops captures while gate is OFF', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    discovery.setCollectionActive(false);
    await simulate({ url: 'https://x.example/api/silent', body: { dropped: true } });
    const eps = discovery.getAllEndpoints();
    const matching = eps.filter((ep): boolean => ep.url.includes('silent'));
    expect(matching.length).toBe(0);
  });

  it('resumes recording after gate is flipped back ON', async () => {
    const page = makePage();
    const discovery = createNetworkDiscovery(page);
    discovery.setCollectionActive(false);
    await simulate({ url: 'https://x.example/api/dropped', body: { ok: true } });
    discovery.setCollectionActive(true);
    await simulate({ url: 'https://x.example/api/recorded', body: { ok: true } });
    const eps = discovery.getAllEndpoints();
    const dropped = eps.filter((ep): boolean => ep.url.includes('dropped'));
    const recorded = eps.filter((ep): boolean => ep.url.includes('recorded'));
    expect(dropped.length).toBe(0);
    expect(recorded.length).toBeGreaterThanOrEqual(1);
  });

  it('frozen network setCollectionActive is a no-op (does not throw)', () => {
    const frozen = createFrozenNetwork([], false);
    const wasApplied = frozen.setCollectionActive(false);
    expect(wasApplied).toBe(true);
  });
});

describe('NetworkDiscovery — frozen network bucketing', () => {
  it('frozen network inherits the click-at value from constructor', () => {
    const eps: readonly IDiscoveredEndpoint[] = [
      makeEndpoint('https://x.example/api/login', 100),
      makeEndpoint('https://x.example/api/getTransactions', 500, 'POST'),
    ];
    const frozen = createFrozenNetwork(eps, false, 200);
    const clickAt = frozen.getDashboardClickAt();
    expect(clickAt).toBe(200);
  });

  it('frozen network defaults click-at to false when not provided', () => {
    const frozen = createFrozenNetwork([], false);
    const clickAt = frozen.getDashboardClickAt();
    expect(clickAt).toBe(false);
  });

  it('getPreNavCaptures filters captures by timestamp < clickAt', () => {
    const eps: readonly IDiscoveredEndpoint[] = [
      makeEndpoint('https://x.example/api/login', 100),
      makeEndpoint('https://x.example/api/widget', 150),
      makeEndpoint('https://x.example/api/getTransactions', 500, 'POST'),
    ];
    const frozen = createFrozenNetwork(eps, false, 200);
    const pre = frozen.getPreNavCaptures();
    expect(pre.length).toBe(2);
    expect(pre[0].url).toContain('login');
    expect(pre[1].url).toContain('widget');
  });

  it('getPostNavCaptures filters captures by timestamp >= clickAt when txn match present', () => {
    const eps: readonly IDiscoveredEndpoint[] = [
      makeEndpoint('https://x.example/api/login', 100),
      makeEndpoint('https://x.example/api/getTransactions', 500, 'POST'),
    ];
    const frozen = createFrozenNetwork(eps, false, 200);
    const post = frozen.getPostNavCaptures();
    expect(post.length).toBe(1);
    expect(post[0].url).toContain('getTransactions');
  });

  it('getPostNavCaptures returns ONLY post-click captures (no soft-fallback, strict SRP)', () => {
    const eps: readonly IDiscoveredEndpoint[] = [
      // pre-click — txn-shaped but NOT in the post-nav window
      makeEndpoint('https://x.example/api/getTransactions', 50, 'POST'),
      makeEndpoint('https://x.example/api/login', 100),
      // post-click — present in window but NOT a WK txn match
      makeEndpoint('https://x.example/api/random', 500),
    ];
    // clickAt at 200 → post-nav window is [200, ∞); only `random` is in
    // it. Strict SRP: no soft-fallback to the full pool. Mixing
    // pre-click and post-click captures is the exact bug the gate
    // exists to prevent.
    const frozen = createFrozenNetwork(eps, false, 200);
    const post = frozen.getPostNavCaptures();
    expect(post.length).toBe(1);
    expect(post[0].url).toContain('random');
  });

  it('getPostNavCaptures widens to full pool when no click marker has been set (Visacal-class)', () => {
    const eps: readonly IDiscoveredEndpoint[] = [
      makeEndpoint('https://x.example/api/getTransactions', 50, 'POST'),
    ];
    const frozen = createFrozenNetwork(eps, false, false);
    const post = frozen.getPostNavCaptures();
    expect(post.length).toBe(1);
  });

  it('discoverTransactionsEndpoint uses post-nav pool', () => {
    const postEp: IDiscoveredEndpoint = {
      url: 'https://x.example/api/getTransactionsList',
      method: 'POST',
      postData: '{"cardUniqueId":"FAKE"}',
      responseBody: { transactions: [{ date: '2026-01-01', amount: -10, description: 'FAKE' }] },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 500,
    };
    const eps: readonly IDiscoveredEndpoint[] = [
      // pre-nav: dashboard widget that matches WK transactions but isn't
      // the real full-history endpoint
      makeEndpoint('https://x.example/api/getLatestTransactions', 100, 'POST'),
      // post-nav: the real full-history endpoint with transaction shape
      postEp,
    ];
    const frozen = createFrozenNetwork(eps, false, 200);
    const picked = frozen.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toContain('getTransactionsList');
    }
  });
});
