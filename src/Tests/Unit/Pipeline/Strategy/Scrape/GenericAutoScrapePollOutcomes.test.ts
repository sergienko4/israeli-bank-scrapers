/**
 * Generic auto-discover poll outcomes — race-condition resolution path
 * added so CI runs that race against late-arriving SPA responses recover
 * automatically. Tests the four explicit outcomes emitted at debug/warn
 * level so future regressions are easy to triage from pipeline.log:
 *
 *   - fast-path hit  : container already captured at scrape.PRE entry
 *   - zero captures  : prior phase didn't capture anything (broken upstream)
 *   - poll succeeded : container arrives within the 3s budget
 *   - poll timed out : 3s budget exhausted; falls through to credential default
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { discoverAndLoadAccounts } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeApi, makeEndpoint, makeNetwork } from '../StrategyTestHelpers.js';

/**
 * Endpoint whose responseBody carries an `accounts` array — qualifies as a
 * named-container hit per WK.accountContainers.
 * @returns Stub endpoint with the WK container shape.
 */
function makeContainerEndpoint(): IDiscoveredEndpoint {
  return makeEndpoint({
    url: 'https://bank.example/api/userData',
    responseBody: { accounts: [{ accountId: 'A1' }] },
  });
}

describe('discoverAndLoadAccounts — generic poll outcomes', () => {
  it('fast-path hit: returns immediately when container already captured', async () => {
    const api = makeApi();
    const ep = makeContainerEndpoint();
    const network = makeNetwork({
      /**
       * Returns the container immediately on first call.
       * @returns Container endpoint.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [ep],
    });
    const startMs = Date.now();
    const result = await discoverAndLoadAccounts(api, network);
    const elapsed = Date.now() - startMs;
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    // Fast path adds 0ms — assert under 200ms to allow CI jitter
    expect(elapsed).toBeLessThan(200);
  });

  it('zero captures: skips poll entirely when no endpoints captured', async () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Always returns empty.
       * @returns Empty list.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
    });
    const startMs = Date.now();
    const result = await discoverAndLoadAccounts(api, network);
    const elapsed = Date.now() - startMs;
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    // Zero-captures fast-fails — should NOT wait the 3s budget
    expect(elapsed).toBeLessThan(500);
  });

  it('poll succeeded: container arrives mid-budget', async () => {
    const api = makeApi();
    const ep = makeContainerEndpoint();
    // First call: empty (fast-path miss + zero-captures dodge via 1 entry)
    // Subsequent calls return the container — simulates late arrival
    let callCount = 0;
    const network = makeNetwork({
      /**
       * First call: list with 1 dummy endpoint (passes zero-check).
       * After 2 calls: returns the container so poll resolves.
       * @returns Endpoint list.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => {
        callCount += 1;
        if (callCount === 1) return [makeEndpoint({ responseBody: { unrelated: 1 } })];
        return [ep];
      },
    });
    const startMs = Date.now();
    const result = await discoverAndLoadAccounts(api, network);
    const elapsed = Date.now() - startMs;
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    // Resolves within the budget — exact timing depends on when between
    // intervals the container appears. Just assert under-budget.
    expect(elapsed).toBeLessThan(2500);
    // Multiple getAllEndpoints calls should have happened (fast-path miss
    // + at least one poll iteration).
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('poll timed out: budget exhausted, falls through to credential default', async () => {
    const api = makeApi();
    // Simulate a network with endpoints captured (so we don't fast-fail)
    // but no container ever arrives — exhausts the 3s budget
    const network = makeNetwork({
      /**
       * Always returns 1 unrelated endpoint — no container ever appears.
       * @returns Single unrelated endpoint.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [
        makeEndpoint({ responseBody: { unrelated: 1 } }),
      ],
    });
    const startMs = Date.now();
    const result = await discoverAndLoadAccounts(api, network);
    const elapsed = Date.now() - startMs;
    const wasOk = isOk(result);
    // Falls through to succeed({}) — discovery never failed, just empty
    expect(wasOk).toBe(true);
    // Should wait the full 3s budget (with some scheduler jitter)
    expect(elapsed).toBeGreaterThan(2500);
    expect(elapsed).toBeLessThan(5000);
  }, 10_000);

  it('poll-tick metadata visible to consumers (smoke check)', async () => {
    const api = makeApi();
    let callCount = 0;
    const network = makeNetwork({
      /**
       * Returns endpoint after a few polls — exercises poll-tick path.
       * @returns Endpoint list.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => {
        callCount += 1;
        if (callCount < 3) return [makeEndpoint({ responseBody: { unrelated: 1 } })];
        return [makeContainerEndpoint()];
      },
    });
    const result = await discoverAndLoadAccounts(api, network);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    // At least the initial fast-path miss + 1 poll-tick should have run
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
