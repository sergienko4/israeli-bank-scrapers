/**
 * Phase 2 coverage closeout — MethodBundles.ts had no co-located
 * unit test, so `isSuccessStatus`, `countSuccessfulFn` and the
 * `discoverTransactionsEndpoint` lambda all ran 0 times against
 * the pipeline coverage gate (4 uncovered branches at lines 53-54,
 * 2 uncovered DA lines at 86 and 114). The 2xx success window
 * branches in `isSuccessStatus` are the empty-gate primitive the
 * SCRAPE.POST prod-safe heuristic relies on — leaving them
 * unguarded means a refactor could silently widen the range.
 *
 * <p>This file pins the 2xx window behaviour and the empty-pool
 * shape of the endpoint-discovery lambdas. No selectors, no DOM —
 * pure function-bundle wiring.
 */
import {
  buildBucketingMethods,
  buildCoreMethods,
  buildEndpointMethods,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/DiscoveryEngine/MethodBundles.js';
import type { IDashboardClickState } from '../../../../../Scrapers/Pipeline/Mediator/Network/EndpointState/EndpointState.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/**
 * Shared base for endpoint fixtures — every field except `status` is
 * constant so tests only vary the status window.
 * @returns Captured endpoint base without a `status` field.
 */
function buildEndpointBase(): Omit<IDiscoveredEndpoint, 'status'> {
  return {
    url: 'https://bank.example/api/x',
    method: 'GET',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody: {},
    timestamp: 1,
  };
}

/**
 * Build a captured endpoint fixture with the provided HTTP status.
 * @param status - HTTP status code under test.
 * @returns Captured endpoint matching the `IDiscoveredEndpoint` shape.
 */
function buildEndpoint(status: number): IDiscoveredEndpoint {
  return { ...buildEndpointBase(), status };
}

/**
 * Build a captured endpoint WITHOUT a `status` field — models the
 * frozen-replay / synthesised-fixture case where the bank capture
 * was recorded without a response status.
 * @returns Captured endpoint with `status` left undefined.
 */
function buildEndpointWithoutStatus(): IDiscoveredEndpoint {
  return buildEndpointBase();
}

/**
 * Click-state stub `mark` — accepts any timestamp, always reports true.
 * @returns Always true (matches IDashboardClickState.mark contract).
 */
function clickStateMark(): true {
  return true;
}

/**
 * Click-state stub `read` — reports "no click yet".
 * @returns Always false (the "no click marked" sentinel).
 */
function clickStateRead(): number | false {
  return false;
}

/**
 * Build a no-op IDashboardClickState. Bucketing methods only need
 * `mark` + `read`; the test exercises the "no click yet" short-
 * circuit at line 133 of MethodBundles.ts.
 * @returns Click-state stub with read returning false.
 */
function buildIdleClickState(): IDashboardClickState {
  return { mark: clickStateMark, read: clickStateRead };
}

describe('MethodBundles — buildCoreMethods', () => {
  it('MB-COUNT-001 counts only 2xx responses (status in [200, 300))', () => {
    const captured = [
      buildEndpoint(200),
      buildEndpoint(204),
      buildEndpoint(299),
      buildEndpoint(199),
      buildEndpoint(300),
      buildEndpoint(404),
      buildEndpoint(500),
    ];
    const methods = buildCoreMethods(captured);
    const count = methods.countSuccessfulResponses();
    expect(count).toBe(3);
  });

  it('MB-COUNT-002 treats undefined status as 0 (non-2xx)', () => {
    const captured = [buildEndpointWithoutStatus(), buildEndpoint(200)];
    const methods = buildCoreMethods(captured);
    const count = methods.countSuccessfulResponses();
    expect(count).toBe(1);
  });

  it('MB-COUNT-003 returns 0 for an empty pool', () => {
    const methods = buildCoreMethods([]);
    const count = methods.countSuccessfulResponses();
    expect(count).toBe(0);
  });

  it('MB-FIND-001 filters captured pool by URL pattern', () => {
    const captured = [
      { ...buildEndpoint(200), url: 'https://b.example/api/transactions' },
      { ...buildEndpoint(200), url: 'https://b.example/api/balance' },
    ];
    const methods = buildCoreMethods(captured);
    const matched = methods.findEndpoints(/transactions/);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.url).toContain('transactions');
  });

  it('MB-GETALL-001 returns a shallow copy of the captured pool', () => {
    const captured = [buildEndpoint(200)];
    const methods = buildCoreMethods(captured);
    const snapshot = methods.getAllEndpoints();
    expect(snapshot).toEqual(captured);
    expect(snapshot).not.toBe(captured);
  });
});

describe('MethodBundles — buildEndpointMethods', () => {
  it('MB-EP-TXN-001 returns false when no captured endpoint matches WK txn patterns', () => {
    const methods = buildEndpointMethods([]);
    const result = methods.discoverTransactionsEndpoint();
    expect(result).toBe(false);
  });

  it('MB-EP-BAL-001 returns false when no captured endpoint matches WK balance patterns', () => {
    const methods = buildEndpointMethods([]);
    const result = methods.discoverBalanceEndpoint();
    expect(result).toBe(false);
  });
});

describe('MethodBundles — buildBucketingMethods (idle click)', () => {
  it('MB-BUCKET-001 returns the full pool for pre/post when no click is marked', () => {
    const captured = [buildEndpoint(200), buildEndpoint(404)];
    const clickState = buildIdleClickState();
    const methods = buildBucketingMethods(captured, clickState);
    const pre = methods.getPreNavCaptures();
    const post = methods.getPostNavCaptures();
    expect(pre).toEqual(captured);
    expect(post).toEqual(captured);
  });
});
