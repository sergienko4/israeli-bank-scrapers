/**
 * Phase 7e — cross-bank FAKE-trace coverage for DASHBOARD.FINAL's
 * {@link resolveTxnEndpoint}.
 *
 * <p>Each fixture under `Fixtures/CrossBank/` encodes ONE bank's TXN
 * response shape with FAKE identifiers. The driver wraps the fixture's
 * `captures` array as the network's discovery surface, runs the
 * resolver, and asserts the resolved {@link ITxnEndpoint} carries the
 * expected method, fieldMap, and records count. The picker drift
 * between WK_TXN / WK_API and any bank's real shape would surface here
 * BEFORE burning live E2E cycles.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { resolveTxnEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/** Bank id enum — closed list of pipeline browser banks today. */
type FixtureBank = 'discount' | 'max' | 'hapoalim' | 'visacal' | 'amex' | 'isracard' | 'beinleumi';

/** Capture entry within a fixture envelope. */
interface IFixtureCapture {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly captureIndex: number;
  readonly postData: string;
  readonly responseBody: unknown;
}

/** Fixture envelope schema — Phase 7e cross-bank TXN coverage. */
interface IFixtureEnvelope {
  readonly _fixture: {
    readonly bank: FixtureBank;
    readonly shape: string;
    readonly expectedMethod: 'GET' | 'POST';
    readonly expectedDateField: string;
    readonly expectedAmountField: string;
    readonly expectedRecords: number;
    readonly expectedPendingUrl: string | false;
    readonly expectedBillingUrl: string | false;
  };
  readonly captures: readonly IFixtureCapture[];
}

/** Loaded fixture record. */
interface ILoadedFixture {
  readonly name: string;
  readonly envelope: IFixtureEnvelope;
}

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const FIXTURE_DIR = path.join(HERE, 'Fixtures', 'CrossBank');

/**
 * Synchronously load every fixture file in the cross-bank directory.
 * @returns Loaded fixtures.
 */
function loadAllFixtures(): readonly ILoadedFixture[] {
  const allFiles = fs.readdirSync(FIXTURE_DIR);
  const jsonFiles = allFiles.filter((f): boolean => f.endsWith('.json'));
  return jsonFiles.map((name): ILoadedFixture => {
    const fullPath = path.join(FIXTURE_DIR, name);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw) as IFixtureEnvelope;
    return { name, envelope: parsed };
  });
}

/**
 * Convert a fixture capture to an {@link IDiscoveredEndpoint}.
 * @param c - Fixture capture entry.
 * @returns Discovered endpoint.
 */
function captureToEndpoint(c: IFixtureCapture): IDiscoveredEndpoint {
  return {
    url: c.url,
    method: c.method,
    postData: c.postData,
    responseBody: c.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex: c.captureIndex,
  };
}

/**
 * Build a stub {@link INetworkDiscovery} that returns the fixture's
 * first capture as the picked TXN endpoint and exposes the full pool
 * for billing-URL discovery. The driver mirrors what
 * {@link discoverTransactionsEndpoint} does in production: pick the
 * first capture matching {@link WK_API.transactions}.
 * @param envelope - Fixture envelope.
 * @returns Stub network surface.
 */
function makeFixtureNetwork(envelope: IFixtureEnvelope): INetworkDiscovery {
  const eps = envelope.captures.map(captureToEndpoint);
  return {
    /**
     * Returns the first capture as the resolved txn endpoint.
     * @returns First fixture capture, adapted.
     */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => {
      if (eps.length === 0) return false;
      return eps[0];
    },
    /**
     * Returns the full pool for billing-URL discovery.
     * @returns All fixture captures.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => eps,
    /**
     * No pattern-matched pending capture; resolver falls through
     * to discoverApiOrigin which the fixtures leave unset.
     * @returns False.
     */
    discoverByPatterns: (): false => false,
    /**
     * No origin probed by these fixtures.
     * @returns False.
     */
    discoverApiOrigin: (): false => false,
  } as unknown as INetworkDiscovery;
}

const ALL_FIXTURES = loadAllFixtures();

/** Closed enum — keep in sync with the browser-bank fixture set. */
const REQUIRED_BANKS: readonly FixtureBank[] = [
  'discount',
  'max',
  'hapoalim',
  'visacal',
  'amex',
  'isracard',
  'beinleumi',
];

describe('Phase 7e — cross-bank TXN-endpoint coverage', () => {
  it('every required browser bank ships at least one TXN fixture', () => {
    const allBanks = ALL_FIXTURES.map((f): FixtureBank => f.envelope._fixture.bank);
    const banks = new Set(allBanks);
    for (const bank of REQUIRED_BANKS) {
      const isPresent = banks.has(bank);
      expect(isPresent).toBe(true);
    }
  });

  describe.each(ALL_FIXTURES)('$name', ({ envelope }) => {
    it('resolveTxnEndpoint returns a non-false endpoint', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      expect(result).not.toBe(false);
    });

    it('resolved endpoint method matches the fixture', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.endpoint.method).toBe(envelope._fixture.expectedMethod);
    });

    it('resolved fieldMap.date and fieldMap.amount match the fixture aliases', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.endpoint.fieldMap.date).toBe(envelope._fixture.expectedDateField);
      expect(result.endpoint.fieldMap.amount).toBe(envelope._fixture.expectedAmountField);
    });

    it('resolved normalizedRecords carries the expected record count', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.normalizedRecords.length).toBe(envelope._fixture.expectedRecords);
    });

    it('resolved billingUrl matches the fixture expectation', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.endpoint.billingUrl).toBe(envelope._fixture.expectedBillingUrl);
    });

    it('resolved pendingUrl matches the fixture expectation', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.endpoint.pendingUrl).toBe(envelope._fixture.expectedPendingUrl);
    });
  });
});

// ── False-positive scenarios — guard the failure paths ──────────────────

/**
 * Stub-method bag — `INetworkDiscovery` carries 10+ helpers and the
 * false-positive driver only exercises `discoverTransactionsEndpoint`
 * + `getAllEndpoints`. Every other helper returns the inert `false /
 * empty / Promise<false>` value real callers ignore in this driver.
 *
 * @param eps - Endpoints to expose through the pre/post pools.
 * @returns Inert stub bag for the un-exercised methods.
 */
function makeInertNetworkParts(eps: readonly IDiscoveredEndpoint[]): Record<string, unknown> {
  return {
    /**
     * URL-pattern probe — never matches in this driver.
     * @returns False.
     */
    discoverByPatterns: (): false => false,
    /**
     * API-origin probe — never matches in this driver.
     * @returns False.
     */
    discoverApiOrigin: (): false => false,
    /**
     * Pre-click capture pool — exposes the supplied endpoints.
     * @returns Endpoints.
     */
    getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => eps,
    /**
     * Post-click capture pool — exposes the supplied endpoints.
     * @returns Endpoints.
     */
    getPostNavCaptures: (): readonly IDiscoveredEndpoint[] => eps,
    /**
     * Dashboard-click timestamp — never set by this driver.
     * @returns False.
     */
    getDashboardClickAt: (): false => false,
    /**
     * Async auth-token probe — never resolves to a token.
     * @returns Promise resolving to false.
     */
    discoverAuthToken: (): Promise<false> => Promise.resolve(false),
    /**
     * SPA-URL probe — never matches in this driver.
     * @returns False.
     */
    discoverSpaUrl: (): false => false,
    /**
     * Transaction-URL builder — never invoked in this driver.
     * @returns False.
     */
    buildTransactionUrl: (): false => false,
    /**
     * Idempotent click-timestamp marker — accepted as a no-op.
     * @returns True.
     */
    markDashboardClickAt: (): true => true,
  };
}

/**
 * Build a stub network surface that the picker rejects. The capture
 * pool is reduced to one entry, mutated with the supplied override.
 * Reused by every false-positive case so the table stays compact.
 *
 * @param envelope - Source fixture (drives the URL pattern).
 * @param overrideBody - Body to splice in over the source body.
 * @returns Network stub returning the mutated capture.
 */
function makeFixtureNetworkWithBody(
  envelope: IFixtureEnvelope,
  overrideBody: unknown,
): INetworkDiscovery {
  const first = envelope.captures[0];
  const mutated: IDiscoveredEndpoint = {
    ...captureToEndpoint(first),
    responseBody: overrideBody,
  };
  return {
    /**
     * Returns the mutated capture as the resolved txn endpoint.
     * @returns Mutated endpoint.
     */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => mutated,
    /**
     * Returns the mutated capture as the only entry.
     * @returns Single-entry pool.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [mutated],
    ...makeInertNetworkParts([mutated]),
  } as unknown as INetworkDiscovery;
}

/**
 * Empty network stub — `discoverTransactionsEndpoint` returns `false`
 * exactly like the real network when no URL pattern matches.
 */
const EMPTY_NETWORK: INetworkDiscovery = {
  /**
   * No txn endpoint resolves from an empty pool.
   * @returns False.
   */
  discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => false,
  /**
   * No captures in this driver.
   * @returns Empty pool.
   */
  getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [],
  ...makeInertNetworkParts([]),
} as unknown as INetworkDiscovery;

/** Empty fieldMap shape — mirrors the `EMPTY_FIELD_MAP` constant
 *  inside ScrapeAutoMapper. Asserted on the `replayablePost`
 *  recovery path. */
const EMPTY_FIELD_MAP_SHAPE = {
  date: '',
  amount: '',
  description: '',
  currency: '',
  identifier: '',
  originalAmount: false,
  processedDate: false,
  balance: false,
} as const;

describe('Phase 7f follow-up — cross-bank DASHBOARD false-positive coverage', () => {
  // ── Hard-reject tier — `resolveTxnEndpoint` MUST return false ──────

  it('returns false when no captured endpoint matches the WK_API.transactions pattern', () => {
    const result = resolveTxnEndpoint(EMPTY_NETWORK);
    expect(result).toBe(false);
  });

  describe.each(ALL_FIXTURES)('$name (hard reject)', ({ envelope }) => {
    it('returns false when the captured body is null (F-DASH-3 malformed response)', () => {
      const network = makeFixtureNetworkWithBody(envelope, null);
      const result = resolveTxnEndpoint(network);
      expect(result).toBe(false);
    });

    it('returns false when the captured body is a primitive string (non-object body)', () => {
      const network = makeFixtureNetworkWithBody(envelope, 'not-an-object');
      const result = resolveTxnEndpoint(network);
      expect(result).toBe(false);
    });

    it('returns false when the captured body is a number (non-object body)', () => {
      const network = makeFixtureNetworkWithBody(envelope, 42);
      const result = resolveTxnEndpoint(network);
      expect(result).toBe(false);
    });
  });

  // ── Soft-commit tier — replayablePost recovery (EMPTY_FIELD_MAP) ──

  describe.each(ALL_FIXTURES)('$name (replayablePost recovery)', ({ envelope }) => {
    it('commits with EMPTY_FIELD_MAP when the txn array is present but empty', () => {
      // Empty txn arrays are valid for replayablePost banks: the URL
      // and method remain authoritative; SCRAPE re-fetches per-account
      // and parseFreshResponse falls back to legacy auto-discovery
      // for that one call. NOT a hard reject.
      const network = makeFixtureNetworkWithBody(envelope, {
        result: { transactions: [] },
      });
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('expected replayablePost commit');
      expect(result.endpoint.fieldMap).toEqual(EMPTY_FIELD_MAP_SHAPE);
      expect(result.normalizedRecords).toEqual([]);
    });

    it('commits with EMPTY_FIELD_MAP when records lack date+amount aliases', () => {
      // Records present but only carry unrelated fields — buildFieldMap
      // returns false → resolveFieldMapOrEmpty returns EMPTY_FIELD_MAP.
      // Same recovery path as the empty-array case.
      const network = makeFixtureNetworkWithBody(envelope, {
        result: {
          transactions: [{ id: 'FAKE-1', someUnrelatedField: 'x' }],
        },
      });
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('expected replayablePost commit');
      expect(result.endpoint.fieldMap).toEqual(EMPTY_FIELD_MAP_SHAPE);
    });

    it('commits with EMPTY_FIELD_MAP when the body has no transaction array shape', () => {
      // Generic non-txn object — passes the body type gate (object,
      // not null), but huntTransactions returns no records.
      const network = makeFixtureNetworkWithBody(envelope, {
        meta: { generated: '2026-05-08' },
        result: { ok: true, message: 'no transactions in this window' },
      });
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('expected replayablePost commit');
      expect(result.endpoint.fieldMap).toEqual(EMPTY_FIELD_MAP_SHAPE);
      expect(result.normalizedRecords).toEqual([]);
    });
  });
});
