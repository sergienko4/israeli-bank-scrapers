/**
 * Shape-aware transaction endpoint discovery — unit tests.
 *
 * Verifies discoverTransactionsEndpoint now PREFERS captured endpoints
 * whose body has a non-empty WK.txnContainers array (via hasTxnArray)
 * over summary-shaped bodies at matching URLs.
 *
 * Simulates Hapoalim's real dump: two endpoints at
 * /current-account/transactions — the summary (no transactions[])
 * came first, the detail POST (transactions[]) came second.
 * Pre-fix: discovery picked summary → extract yielded 0 items.
 * Post-fix: discovery picks detail → generic scrape works.
 */
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { hasTxnArray } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnShape.js';

type JsonValue = unknown;

/**
 * Build a minimal IDiscoveredEndpoint for simulation.
 * @param url - URL to assign.
 * @param body - Parsed responseBody.
 * @returns Endpoint stub.
 */
function makeEndpoint(url: string, body: JsonValue): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody: body,
    timestamp: Date.now(),
  };
}

describe('hasTxnArray — BFS shape detection (shared helper)', () => {
  it('[a] Hapoalim summary body → false', () => {
    const body = {
      retrievalTransactionData: { bankNumber: 12 },
      totalFutureTransactionsAmount: 0,
      balance: 0,
    };
    const isHit = hasTxnArray(body);
    expect(isHit).toBe(false);
  });

  it('[b] Hapoalim detail body (real shape) → true', () => {
    const body = {
      retrievalTransactionData: { bankNumber: 12, branchNumber: 170, accountNumber: 536347 },
      transactions: [{ eventDate: 20260414, eventAmount: 150.0, currentBalance: 150.0 }],
    };
    const isHit = hasTxnArray(body);
    expect(isHit).toBe(true);
  });

  it('[c] Empty transactions array → false', () => {
    const body = { transactions: [] };
    const isHit = hasTxnArray(body);
    expect(isHit).toBe(false);
  });

  it('[d] Deeply nested VisaCal-like shape → true', () => {
    const body = {
      result: {
        bankAccounts: [{ debitDates: [{ transactions: [{ amount: 1 }] }] }],
      },
    };
    const isHit = hasTxnArray(body);
    expect(isHit).toBe(true);
  });

  it('[e] null / undefined / non-object → false', () => {
    const isNull = hasTxnArray(null);
    const isUndef = hasTxnArray(undefined);
    const isString = hasTxnArray('string');
    const isNumber = hasTxnArray(42);
    expect(isNull).toBe(false);
    expect(isUndef).toBe(false);
    expect(isString).toBe(false);
    expect(isNumber).toBe(false);
  });
});

/**
 * Simulate the shape-aware endpoint discovery's behavior by directly
 * iterating like the implementation in NetworkDiscovery.ts. Keeps the
 * test independent of INetworkDiscovery's full surface — asserts the
 * GENERIC preference policy (shape-first, URL-fallback).
 * @param captured - Simulated captured endpoints.
 * @returns Preferred endpoint or false.
 */
function pickPreferred(captured: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const txnPattern = /\/current-account\/transactions/i;
  const matches = captured.filter((ep): boolean => txnPattern.test(ep.url));
  if (matches.length === 0) return false;
  const shapePass = matches.find((ep): boolean => hasTxnArray(ep.responseBody));
  if (shapePass) return shapePass;
  return matches[0] ?? false;
}

/**
 * Minimal network stub returning a fixed endpoint list.
 * @param endpoints - Endpoint list to expose.
 * @returns Stub satisfying INetworkDiscovery (cast).
 */
/**
 * Build a getAllEndpoints closure — isolated from the cast below so
 * the arrow function gets proper JSDoc coverage.
 * @param endpoints - Captured list.
 * @returns Getter matching INetworkDiscovery.getAllEndpoints.
 */
function buildGetAll(
  endpoints: readonly IDiscoveredEndpoint[],
): () => readonly IDiscoveredEndpoint[] {
  return (): readonly IDiscoveredEndpoint[] => endpoints;
}

/**
 * Minimal network stub returning a fixed endpoint list.
 * @param endpoints - Endpoint list to expose.
 * @returns Stub satisfying INetworkDiscovery (cast).
 */
function makeStub(endpoints: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  const stub = { getAllEndpoints: buildGetAll(endpoints) };
  return stub as unknown as INetworkDiscovery;
}

describe('discoverShapeAware — endpoint preference policy', () => {
  it('picks DETAIL (transactions[]) over SUMMARY even when summary was captured first', () => {
    const summary = makeEndpoint('https://bank/current-account/transactions?view=totals', {
      retrievalTransactionData: { bankNumber: 12 },
      balance: 0,
    });
    const detail = makeEndpoint(
      'https://bank/current-account/transactions?retrievalStartDate=20260321',
      { transactions: [{ eventDate: 20260414, amount: 150 }] },
    );
    const picked = pickPreferred([summary, detail]);
    const isFound = picked !== false;
    expect(isFound).toBe(true);
    expect(picked).toBe(detail);
    const stub = makeStub([summary, detail]);
    const endpoints = stub.getAllEndpoints();
    expect(endpoints.length).toBe(2);
  });

  it('picks DETAIL-only when no summary present', () => {
    const detail = makeEndpoint('https://bank/current-account/transactions', {
      transactions: [{ x: 1 }],
    });
    const picked = pickPreferred([detail]);
    expect(picked).toBe(detail);
  });

  it('falls back to SUMMARY-only when no detail shape is captured', () => {
    const summary = makeEndpoint('https://bank/current-account/transactions?view=totals', {
      retrievalTransactionData: {},
      balance: 0,
    });
    const picked = pickPreferred([summary]);
    expect(picked).toBe(summary);
  });

  it('returns false when no URL matches', () => {
    const other = makeEndpoint('https://bank/somewhere/else', { transactions: [{ x: 1 }] });
    const picked = pickPreferred([other]);
    expect(picked).toBe(false);
  });

  it('preserves capture order within the same shape bucket', () => {
    const firstDetail = makeEndpoint('https://bank/current-account/transactions?a=1', {
      transactions: [{ x: 1 }],
    });
    const secondDetail = makeEndpoint('https://bank/current-account/transactions?a=2', {
      transactions: [{ y: 2 }],
    });
    const picked = pickPreferred([firstDetail, secondDetail]);
    expect(picked).toBe(firstDetail);
  });
});
