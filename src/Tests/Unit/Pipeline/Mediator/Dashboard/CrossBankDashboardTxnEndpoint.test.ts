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
      expect(result.method).toBe(envelope._fixture.expectedMethod);
    });

    it('resolved fieldMap.date and fieldMap.amount match the fixture aliases', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.fieldMap.date).toBe(envelope._fixture.expectedDateField);
      expect(result.fieldMap.amount).toBe(envelope._fixture.expectedAmountField);
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
      expect(result.billingUrl).toBe(envelope._fixture.expectedBillingUrl);
    });

    it('resolved pendingUrl matches the fixture expectation', () => {
      const network = makeFixtureNetwork(envelope);
      const result = resolveTxnEndpoint(network);
      if (result === false) throw new ScraperError('resolveTxnEndpoint returned false');
      expect(result.pendingUrl).toBe(envelope._fixture.expectedPendingUrl);
    });
  });
});
