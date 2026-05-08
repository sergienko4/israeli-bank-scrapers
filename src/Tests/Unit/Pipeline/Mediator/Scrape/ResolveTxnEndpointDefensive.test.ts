/**
 * Phase 7e — `resolveTxnEndpoint` defensive branches.
 *
 * <p>The cross-bank suite already exercises the success path against
 * 7 real-shape fixtures. This driver pins the defensive `false`-return
 * branches that protect SCRAPE from inheriting a malformed contract:
 * <ul>
 *   <li>Picker returned `false` (no URL match in pool).</li>
 *   <li>Body is `null`.</li>
 *   <li>Body is not an object (string / number / boolean).</li>
 *   <li>Method is neither GET nor POST.</li>
 * </ul>
 *
 * <p>It also covers `resolveFieldMapOrEmpty`'s two branches: zero
 * records → EMPTY_FIELD_MAP, and `buildFieldMap` rejects the first
 * record → EMPTY_FIELD_MAP. Both surface as a successful commit with
 * empty aliases, deferring real fieldMap discovery to SCRAPE's
 * per-account fetch. This is the "replayablePost with empty
 * window" recovery path observed on Discount/Visacal.
 */

import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { resolveTxnEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/** Per-method overrides for {@link makeNetwork}. */
interface INetworkOverrides {
  readonly all?: readonly IDiscoveredEndpoint[];
  readonly pendingByPatterns?: IDiscoveredEndpoint | false;
  readonly apiOrigin?: string | false;
}

/**
 * Build a minimal stub `INetworkDiscovery` with the methods the
 * resolver actually calls; the rest are unsupported and throw if
 * touched, so any drift in the resolver's call surface fails this test.
 *
 * @param picked - What `discoverTransactionsEndpoint` returns.
 * @param overrides - Optional pool / pending / origin overrides.
 * @returns Stub network surface.
 */
function makeNetwork(
  picked: IDiscoveredEndpoint | false,
  overrides: INetworkOverrides = {},
): INetworkDiscovery {
  /**
   * Stub picker — echoes the value passed to {@link makeNetwork}.
   *
   * @returns The bound `picked` value.
   */
  const discoverTransactionsEndpoint = (): IDiscoveredEndpoint | false => picked;
  /**
   * Stub pool reader — echoes the bound `overrides.all`.
   *
   * @returns The bound captures (or `[]`).
   */
  const getAllEndpoints = (): readonly IDiscoveredEndpoint[] => overrides.all ?? [];
  /**
   * Stub pattern picker — echoes `overrides.pendingByPatterns`.
   *
   * @returns The bound pending endpoint or `false`.
   */
  const discoverByPatterns = (): IDiscoveredEndpoint | false =>
    overrides.pendingByPatterns ?? false;
  /**
   * Stub API origin — echoes `overrides.apiOrigin`.
   *
   * @returns The bound origin or `false`.
   */
  const discoverApiOrigin = (): string | false => overrides.apiOrigin ?? false;
  const surface: Record<string, unknown> = {
    discoverTransactionsEndpoint,
    getAllEndpoints,
    discoverByPatterns,
    discoverApiOrigin,
  };
  return surface as unknown as INetworkDiscovery;
}

/**
 * Build a minimal endpoint with the fields the resolver inspects.
 *
 * @param overrides - Per-test overrides.
 * @returns Endpoint stub.
 */
function makeEndpoint(overrides: Partial<IDiscoveredEndpoint>): IDiscoveredEndpoint {
  const base: IDiscoveredEndpoint = {
    url: 'https://bank.fake.example/api/txns',
    method: 'POST',
    postData: '',
    responseBody: { transactions: [] },
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
    captureIndex: 1,
  };
  return { ...base, ...overrides };
}

describe('resolveTxnEndpoint — defensive branches (Phase 7e)', () => {
  it('returns false when discoverTransactionsEndpoint picker returns false', () => {
    const network = makeNetwork(false);
    const result = resolveTxnEndpoint(network);
    expect(result).toBe(false);
  });

  it('returns false when responseBody is null (typeof object guard)', () => {
    const ep = makeEndpoint({ responseBody: null });
    const network = makeNetwork(ep);
    const result = resolveTxnEndpoint(network);
    expect(result).toBe(false);
  });

  it('returns false when responseBody is a string (typeof !== object)', () => {
    // The response shape is unknown but typed-loose for cross-bank tolerance;
    // a non-object body cannot expose a fieldMap so the resolver must reject.
    const ep = makeEndpoint({ responseBody: 'not-json' });
    const network = makeNetwork(ep);
    const result = resolveTxnEndpoint(network);
    expect(result).toBe(false);
  });

  it('returns false when method is neither GET nor POST', () => {
    const ep = makeEndpoint({ method: 'DELETE' as unknown as 'GET' });
    const network = makeNetwork(ep);
    const result = resolveTxnEndpoint(network);
    expect(result).toBe(false);
  });

  it('commits with EMPTY_FIELD_MAP when the captured body has zero records (empty session window)', () => {
    // `replayablePost` URL but body has no transactions — Discount-class
    // recovery path. The resolver must commit (URL is authoritative)
    // with empty aliases; SCRAPE re-fetches per account.
    const ep = makeEndpoint({ responseBody: { transactions: [] }, method: 'POST' });
    const network = makeNetwork(ep);
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.endpoint.method).toBe('POST');
      expect(result.endpoint.fieldMap.date).toBe('');
      expect(result.endpoint.fieldMap.amount).toBe('');
      expect(result.normalizedRecords.length).toBe(0);
    }
  });

  it('commits with EMPTY_FIELD_MAP when the first record exposes no date+amount aliases', () => {
    // Record has fields but none match WK aliases — buildFieldMap
    // returns false; resolver still commits the URL.
    const ep = makeEndpoint({
      responseBody: { transactions: [{ irrelevantKey: 'no-aliases' }] },
      method: 'POST',
    });
    const network = makeNetwork(ep);
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.endpoint.fieldMap.date).toBe('');
      expect(result.endpoint.fieldMap.amount).toBe('');
    }
  });

  it('commits pendingUrl from a captured pending pattern hit', () => {
    const ep = makeEndpoint({ responseBody: { transactions: [{ date: 'd', amount: 1 }] } });
    const pendingEp: IDiscoveredEndpoint = {
      ...ep,
      url: 'https://bank.fake.example/api/pending-widget',
    };
    const network = makeNetwork(ep, { pendingByPatterns: pendingEp });
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.endpoint.pendingUrl).toBe('https://bank.fake.example/api/pending-widget');
    }
  });

  it('commits pendingUrl synthesised from a discovered API origin when no pattern hit', () => {
    const ep = makeEndpoint({ responseBody: { transactions: [{ date: 'd', amount: 1 }] } });
    const network = makeNetwork(ep, { apiOrigin: 'https://api.bank.fake.example' });
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(typeof result.endpoint.pendingUrl).toBe('string');
      if (result.endpoint.pendingUrl !== false) {
        expect(result.endpoint.pendingUrl).toContain('https://api.bank.fake.example');
      }
    }
  });

  it('commits billingUrl from a direct WK_BILLING.pathFragment hit in the pool', () => {
    const ep = makeEndpoint({ responseBody: { transactions: [{ date: 'd', amount: 1 }] } });
    const billingHit = makeEndpoint({
      url: 'https://bank.fake.example/Transactions/api/transactionsDetails/getCardTransactionsDetails',
    });
    const network = makeNetwork(ep, { all: [billingHit] });
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(typeof result.endpoint.billingUrl).toBe('string');
      if (result.endpoint.billingUrl !== false) {
        expect(result.endpoint.billingUrl).toContain('transactionsDetails');
      }
    }
  });

  it('commits billingUrl=false when no captured pool entry matches WK_BILLING or carries a card id', () => {
    const ep = makeEndpoint({ responseBody: { transactions: [{ date: 'd', amount: 1 }] } });
    const unrelated = makeEndpoint({ url: 'https://bank.fake.example/api/balance', postData: '' });
    const network = makeNetwork(ep, { all: [unrelated] });
    const result = resolveTxnEndpoint(network);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.endpoint.billingUrl).toBe(false);
    }
  });
});
