/**
 * Unit test for the Option B response-shape gate inside countTxnTraffic.
 * Verifies hasTxnArray (private helper) indirectly through countTxnTraffic
 * by feeding a minimal INetworkDiscovery mock. Ensures the gate flips from
 * the old "URL match + body exists" semantic to "URL match + non-empty
 * txn array in body".
 *
 * These shapes mirror what the Hapoalim live E2E captured as summary vs
 * full-txn responses, plus generic shapes other banks rely on.
 */
import { countTxnTraffic } from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

type JsonValue = unknown;

/** Common URL matching PIPELINE_WELL_KNOWN_API.transactions regex. */
const TXN_URL = 'https://bank.example.com/current-account/transactions?view=totals';

/**
 * Build a minimal IDiscoveredEndpoint with only the fields the gate reads.
 * @param url - Endpoint URL.
 * @param body - Parsed response body.
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

/**
 * getAllEndpoints closure — isolated to dodge the nested-call rule.
 * @param endpoints - Endpoint list.
 * @returns Getter function.
 */
function makeGetter(
  endpoints: readonly IDiscoveredEndpoint[],
): () => readonly IDiscoveredEndpoint[] {
  return (): readonly IDiscoveredEndpoint[] => endpoints;
}

/**
 * Build a minimal INetworkDiscovery stub exposing the single endpoint list.
 * @param endpoints - Captured endpoints.
 * @returns Stub satisfying INetworkDiscovery (cast).
 */
function makeNetworkStub(endpoints: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  const stub = { getAllEndpoints: makeGetter(endpoints) };
  return stub as unknown as INetworkDiscovery;
}

/**
 * Helper: count traffic for a single given body with the default URL.
 * @param body - Response body to probe.
 * @returns Count reported by countTxnTraffic.
 */
function countFor(body: JsonValue): number {
  const endpoint = makeEndpoint(TXN_URL, body);
  const network = makeNetworkStub([endpoint]);
  return countTxnTraffic(network, 0);
}

describe('countTxnTraffic — Option B response-shape gate', () => {
  it('[a] Hapoalim summary (no transactions[] array) → 0', () => {
    const body = {
      metadata: { messages: [] },
      retrievalTransactionData: { bankNumber: 12 },
      totalFutureTransactionsAmount: 0,
      balance: 0,
    };
    const count = countFor(body);
    expect(count).toBe(0);
  });

  it('[b] Full root-level transactions array → 1', () => {
    const body = {
      transactions: [
        { date: '2026-04-19', amount: 100 },
        { date: '2026-04-18', amount: 200 },
      ],
    };
    const count = countFor(body);
    expect(count).toBe(1);
  });

  it('[c] Empty transactions array → 0', () => {
    const body = { transactions: [] };
    const count = countFor(body);
    expect(count).toBe(0);
  });

  it('[d] Nested VisaCal-like result.bankAccounts[*].debitDates[*].transactions[] → 1', () => {
    const body = {
      result: {
        bankAccounts: [{ debitDates: [{ transactions: [{ date: '2026-03-15', amount: 50 }] }] }],
      },
    };
    const count = countFor(body);
    expect(count).toBe(1);
  });

  it('[e] Nested result.accounts[0].txns[...] → 1', () => {
    const body = {
      result: { accounts: [{ txns: [{ date: '2026-04-01', amount: 25 }] }] },
    };
    const count = countFor(body);
    expect(count).toBe(1);
  });

  it('[f] null / undefined / non-object body → 0', () => {
    const nullCount = countFor(null);
    const undefCount = countFor(undefined);
    const stringCount = countFor('not-an-object');
    const numberCount = countFor(42);
    expect(nullCount).toBe(0);
    expect(undefCount).toBe(0);
    expect(stringCount).toBe(0);
    expect(numberCount).toBe(0);
  });

  it('[g] transactions field with non-array value → 0', () => {
    const body = { transactions: 'not-an-array' };
    const count = countFor(body);
    expect(count).toBe(0);
  });

  it('[h] URL match but body absent → 0', () => {
    const endpoint = makeEndpoint(TXN_URL, null);
    const network = makeNetworkStub([endpoint]);
    const count = countTxnTraffic(network, 0);
    expect(count).toBe(0);
  });

  it('[i] Mixed set — summary + real txn → exactly 1', () => {
    const summary = { metadata: {}, balance: 0 };
    const real = { transactions: [{ date: 'x', amount: 1 }] };
    const summaryEndpoint = makeEndpoint(TXN_URL, summary);
    const realEndpoint = makeEndpoint(TXN_URL, real);
    const network = makeNetworkStub([summaryEndpoint, realEndpoint]);
    const count = countTxnTraffic(network, 0);
    expect(count).toBe(1);
  });

  it('[j] URL does NOT match txn regex → 0 even with real shape', () => {
    const body = { transactions: [{ date: 'x', amount: 1 }] };
    const endpoint = makeEndpoint('https://bank.example.com/whatever/not-txn', body);
    const network = makeNetworkStub([endpoint]);
    const count = countTxnTraffic(network, 0);
    expect(count).toBe(0);
  });
});
