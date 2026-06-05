/**
 * Edge-case unit tests for the SHAPED-fallback branch of
 * {@link resolveBillingUrl} (rubber-duck MEDIUM #3 — Phase 2 close-out).
 *
 * `findShapedBillingEndpoint` is invoked when no captured URL carries
 * the {@link PIPELINE_WELL_KNOWN_BILLING.pathFragment}. It scans
 * `getAllEndpoints()` for a transaction-URL capture whose POST body
 * carries any {@link PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS.queryId}
 * alias, which proves the request is per-card. The synthesised URL
 * is then built under the shaped capture's origin via
 * `buildBillingUrlFromOrigin`.
 *
 * The cross-bank ResolveTxnEndpoint fixture suite hits the DIRECT
 * branch (captured URL already includes `transactionsDetails`). It
 * never exercises:
 *
 * <ul>
 *   <li>shaped capture (txn URL + card-id alias in POST body) when
 *       no direct billing URL exists → returns synthesised URL;</li>
 *   <li>txn capture without any card-id alias in POST body → returns
 *       false (no shaped capture);</li>
 *   <li>direct billing capture present → returns direct, shaped path
 *       not consulted (verifies short-circuit ordering).</li>
 * </ul>
 *
 * Per `test-guidlines.md` "unit test for edge cases only" — additive
 * Phase 2 close-out branch-buffer coverage, no existing tests modified.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { resolveBillingUrl } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/EndpointResolver/EndpointUrlHelpers.js';

const BANK_ORIGIN = 'https://bank.example.com';
const SHAPED_TXN_URL = `${BANK_ORIGIN}/Some/api/TransactionsAndGraphs/getTxns?id=4242`;
const DIRECT_BILLING_URL = `${BANK_ORIGIN}/Transactions/api/transactionsDetails/getCardTransactionsDetails`;
const EXPECTED_BUILT_URL = `${BANK_ORIGIN}/Transactions/api/transactionsDetails/getCardTransactionsDetails`;

const DEFAULT_DISCOVERED_ENDPOINT = {
  responseBody: {},
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 0,
  dumpCounter: 0,
} as const;

/**
 * Build a minimal `IDiscoveredEndpoint` stub for the tests below.
 * @param url - URL the capture should expose.
 * @param postData - Raw POST body (empty when not a POST).
 * @returns Capture matching the discovery contract surface.
 */
function makeEndpoint(url: string, postData: string): IDiscoveredEndpoint {
  return {
    ...DEFAULT_DISCOVERED_ENDPOINT,
    url,
    method: postData ? 'POST' : 'GET',
    postData,
  };
}

/**
 * Return the captured endpoints back to the caller — used as the
 * `getAllEndpoints` accessor on the test-only network stub.
 * @param endpoints - Pre-built fake capture pool.
 * @returns Same array, narrowed to readonly.
 */
function returnEndpoints(endpoints: IDiscoveredEndpoint[]): readonly IDiscoveredEndpoint[] {
  return endpoints;
}

/**
 * Build a minimal `INetworkDiscovery` stub exposing only the
 * `getAllEndpoints()` accessor that `resolveBillingUrl` consumes.
 * @param endpoints - Fake capture pool to back the accessor.
 * @returns Stub typed as the full discovery contract.
 */
function makeNetworkStub(endpoints: IDiscoveredEndpoint[]): INetworkDiscovery {
  /**
   * Closure accessor matching `INetworkDiscovery.getAllEndpoints()`.
   * @returns The pre-built fake capture pool.
   */
  const getAllEndpoints = (): readonly IDiscoveredEndpoint[] => returnEndpoints(endpoints);
  return { getAllEndpoints } as INetworkDiscovery;
}

describe('resolveBillingUrl — shaped-fallback path', () => {
  it('returns synthesised URL when a txn capture carries a card-id alias and no direct billing URL exists', () => {
    const shaped = makeEndpoint(SHAPED_TXN_URL, '{"cardUniqueId":"42424242"}');
    const network = makeNetworkStub([shaped]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(EXPECTED_BUILT_URL);
  });

  it('returns false when every txn capture lacks a card-id alias in postData', () => {
    const noCardId = makeEndpoint(SHAPED_TXN_URL, '{"date":"2026-06-01"}');
    const network = makeNetworkStub([noCardId]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(false);
  });

  it('returns false when postData is empty (billingBodyCarriesCardId early-return path)', () => {
    const noBody = makeEndpoint(SHAPED_TXN_URL, '');
    const network = makeNetworkStub([noBody]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(false);
  });

  it('returns false when no captured URL matches any txn pattern', () => {
    const unrelated = makeEndpoint(
      `${BANK_ORIGIN}/Some/api/userAccountsData`,
      '{"cardUniqueId":"x"}',
    );
    const network = makeNetworkStub([unrelated]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(false);
  });

  it('returns false on empty capture pool', () => {
    const network = makeNetworkStub([]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(false);
  });
});

describe('resolveBillingUrl — direct branch short-circuits shaped lookup', () => {
  it('returns direct URL when one capture carries WK_BILLING.pathFragment even if a shaped capture also exists', () => {
    const direct = makeEndpoint(DIRECT_BILLING_URL, '{"cardUniqueId":"99"}');
    const shaped = makeEndpoint(SHAPED_TXN_URL, '{"bankAccountUniqueId":"x"}');
    const network = makeNetworkStub([shaped, direct]);
    const out = resolveBillingUrl(network);
    expect(out).toBe(EXPECTED_BUILT_URL);
  });
});
