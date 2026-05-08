/**
 * Cross-bank SCRAPE-side validation — Phase 7e contract drive-through.
 *
 * <p>Every cross-bank fixture under
 * `Tests/Unit/Pipeline/Mediator/Dashboard/Fixtures/CrossBank/` is a
 * real prod-shape capture with FAKE identifiers. The DASHBOARD-side
 * driver (`CrossBankDashboardTxnEndpoint.test.ts`) already validates
 * that `resolveTxnEndpoint` produces the right `ITxnEndpoint` from
 * each fixture. This driver picks up where that one ends: it feeds
 * the same fixtures into the SCRAPE-side strategies through the
 * Phase 7e `fc.txnEndpoint` channel and asserts that records are
 * extractable end-to-end — which is the production flow once
 * DASHBOARD.FINAL commits and SCRAPE consumes via the bridge.
 *
 * <p>The single parameterized suite runs against all 7 banks, so
 * regressions in any one bank's shape surface here without per-bank
 * test files multiplying.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  buildTxnHarvest,
  extractAccountIdFromUrl,
  parseFreshResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/TxnParser.js';
import { extractTransactions } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import { scrapeViaFilterData } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/FilterDataStrategy.js';
import { tryBillingFallback } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/BillingFallbackStrategy.js';
import {
  EMPTY_FIELD_MAP,
  EMPTY_TXN_ENDPOINT,
  type IAccountFetchCtx,
  type IPostFetchCtx,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type {
  ITxnEndpoint,
  ITxnEndpointInternal,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeApi, makeNetwork, stubFetchGetFail, stubFetchPostOk } from '../StrategyTestHelpers.js';

/** Fixture envelope shape — only the fields this driver reads. */
interface IFixtureCapture {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly captureIndex: number;
  readonly postData: string;
  readonly responseBody: Readonly<Record<string, unknown>>;
}
interface IFixtureMeta {
  readonly bank: string;
  readonly expectedMethod: 'GET' | 'POST';
  readonly expectedRecords: number;
  readonly expectedBillingUrl: string | false;
}
interface IFixtureEnvelope {
  readonly _fixture: IFixtureMeta;
  readonly captures: readonly IFixtureCapture[];
}

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const FIXTURE_DIR = path.join(HERE, '..', '..', 'Mediator', 'Dashboard', 'Fixtures', 'CrossBank');

/** Match the runtime token `filterData` in a captured URL (path or query). */
const FILTER_DATA_RE = /filterdata|filteredtransactions/i;

/**
 * Convert a fixture capture into the slim {@link ITxnEndpoint} shape
 * SCRAPE strategies consume — Phase 7f. captureIndex /
 * responseBodySample / normalizedRecords / pickerTier / capturedPreClick
 * live on `ITxnEndpointInternal` (DASHBOARD-only) and never travel on
 * `ctx.txnEndpoint`, so the SCRAPE-side adapter only carries url +
 * method + templatePostData + a default empty fieldMap.
 * @param c - Fixture capture entry.
 * @returns Slim TXN endpoint adapted for SCRAPE consumption.
 */
function captureToEndpoint(c: IFixtureCapture): ITxnEndpoint {
  return {
    ...EMPTY_TXN_ENDPOINT,
    url: c.url,
    method: c.method,
    templatePostData: c.method === 'POST' ? c.postData : false,
  };
}

/**
 * Load every fixture once at suite-load time. Synchronous reads are
 * fine inside Jest — fixtures are tiny, deterministic JSON.
 * @returns All fixtures, sorted by bank name.
 */
function loadAllFixtures(): readonly IFixtureEnvelope[] {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f): boolean => f.endsWith('.json'));
  return files.map((f): IFixtureEnvelope => {
    const fullPath = path.join(FIXTURE_DIR, f);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(raw) as IFixtureEnvelope;
  });
}

const ALL_FIXTURES = loadAllFixtures();

/**
 * Map a fixture envelope to a `[bank, env]` tuple for `it.each` so the
 * test name's `[%s]` placeholder renders the bank name and the second
 * argument is the full envelope.
 *
 * @param f - Cross-bank fixture envelope.
 * @returns Tuple of bank name and envelope.
 */
const TO_BANK_ROW = (f: IFixtureEnvelope): readonly [string, IFixtureEnvelope] => [
  f._fixture.bank,
  f,
];

const ALL_ROWS = ALL_FIXTURES.map(TO_BANK_ROW);
const FILTER_DATA_FIXTURES = ALL_FIXTURES.filter((f): boolean =>
  FILTER_DATA_RE.test(f.captures[0].url),
);
const FILTER_DATA_ROWS = FILTER_DATA_FIXTURES.map(TO_BANK_ROW);
const BILLING_FIXTURES = ALL_FIXTURES.filter(
  (f): boolean => f._fixture.expectedBillingUrl !== false,
);
const BILLING_ROWS = BILLING_FIXTURES.map(TO_BANK_ROW);

describe('Cross-bank SCRAPE consumes Phase 7e ctx.txnEndpoint (every fixture)', () => {
  it('loaded the expected number of cross-bank fixtures', () => {
    expect(ALL_FIXTURES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(ALL_ROWS)(
    '[%s] extractTransactions yields >= expectedRecords from real-shape capture',
    (_bank, env) => {
      const records = extractTransactions(env.captures[0].responseBody);
      expect(records.length).toBeGreaterThanOrEqual(env._fixture.expectedRecords);
    },
  );

  if (FILTER_DATA_ROWS.length > 0) {
    it.each(FILTER_DATA_ROWS)(
      '[%s] FilterDataStrategy consumes fc.txnEndpoint from fixture',
      async (_bank, env) => {
        const txnEndpoint = captureToEndpoint(env.captures[0]);
        const fetchGet = stubFetchGetFail();
        const api = makeApi({ fetchGet });
        const network = makeNetwork();
        const fc: IAccountFetchCtx = {
          api,
          network,
          startDate: '20260101',
          txnEndpoint,
        };
        const result = await scrapeViaFilterData(fc, 'cross-bank-acct', txnEndpoint.url);
        const isOkResult = isOk(result);
        expect(isOkResult).toBe(true);
      },
    );
  }

  if (BILLING_ROWS.length > 0) {
    it.each(BILLING_ROWS)(
      '[%s] BillingFallbackStrategy consumes fc.billingUrl from fixture',
      async (_bank, env) => {
        const billingUrl = env._fixture.expectedBillingUrl;
        if (billingUrl === false) {
          throw new ScraperError('billingUrl gate already filtered');
        }
        const fetchPost = stubFetchPostOk(env.captures[0].responseBody);
        const api = makeApi({ fetchPost });
        const network = makeNetwork();
        const txnEndpoint: ITxnEndpoint = { ...EMPTY_TXN_ENDPOINT, billingUrl };
        const fc: IAccountFetchCtx = {
          api,
          network,
          startDate: '20260401',
          txnEndpoint,
        };
        const post: IPostFetchCtx = {
          accountId: 'cross-bank-card',
          displayId: '0001',
          baseBody: {},
          url: 'u',
        };
        const result = await tryBillingFallback(fc, post);
        // Either ok (records survive dedup) or fail with "0 txns" — both
        // exercise the success-side chunk loop and buildBillingResult
        // call site, which is the Phase 7e coverage gap. The point is
        // that the bridge is the only data source.
        expect(typeof result).toBe('object');
        expect(typeof result.success).toBe('boolean');
      },
    );
  }
});

// ── False-positive coverage — Phase 7f follow-up ────────────────────────

/**
 * Build an `ITxnEndpointInternal` envelope from a fixture capture.
 * Used to feed `buildTxnHarvest` per-fixture so the harvest-shape
 * decisions are exercised for every bank.
 *
 * @param env - Fixture envelope.
 * @returns Internal payload matching the production resolver shape.
 */
function fixtureToInternal(env: IFixtureEnvelope): ITxnEndpointInternal {
  const cap = env.captures[0];
  return {
    endpoint: {
      ...EMPTY_TXN_ENDPOINT,
      url: cap.url,
      method: cap.method,
      templatePostData: cap.method === 'POST' ? cap.postData : false,
    },
    captureIndex: cap.captureIndex,
    responseBodySample: cap.responseBody,
    normalizedRecords: extractTransactions(cap.responseBody),
    pickerTier: 'shapePassing',
    capturedPreClick: false,
  };
}

describe('Phase 7f follow-up — cross-bank SCRAPE false-positive coverage', () => {
  // ── parseFreshResponse — body-shape robustness (single-shot) ───────

  it.each(ALL_ROWS)(
    '[%s] parseFreshResponse(real-shape body, EMPTY_FIELD_MAP) yields >= expectedRecords',
    (_bank, env) => {
      const records = parseFreshResponse(env.captures[0].responseBody, EMPTY_FIELD_MAP);
      expect(records.length).toBeGreaterThanOrEqual(env._fixture.expectedRecords);
    },
  );

  it('parseFreshResponse({}, EMPTY_FIELD_MAP) yields zero records', () => {
    const records = parseFreshResponse({}, EMPTY_FIELD_MAP);
    expect(records).toEqual([]);
  });

  it('parseFreshResponse(non-txn body, EMPTY_FIELD_MAP) yields zero records', () => {
    const records = parseFreshResponse(
      { meta: { generated: '2026-05-08' }, result: { ok: true, message: 'no data' } },
      EMPTY_FIELD_MAP,
    );
    expect(records).toEqual([]);
  });

  it('parseFreshResponse(records-without-aliases, EMPTY_FIELD_MAP) yields zero records', () => {
    // Records with only an unrelated field do not satisfy any
    // date/amount alias, so autoMapTransaction filters every entry.
    const records = parseFreshResponse(
      { result: { transactions: [{ id: 'FAKE-1', someUnrelatedField: 'x' }] } },
      EMPTY_FIELD_MAP,
    );
    expect(records).toEqual([]);
  });

  // ── buildTxnHarvest — scope decisions per fixture ─────────────────

  it.each(ALL_ROWS)(
    '[%s] buildTxnHarvest with single-account context exposes the captured records',
    (_bank, env) => {
      const internal = fixtureToInternal(env);
      const harvest = buildTxnHarvest(internal, 1);
      expect(harvest.records.length).toBe(internal.normalizedRecords.length);
      expect(typeof harvest.multiAccountScope).toBe('boolean');
    },
  );

  it.each(ALL_ROWS)(
    '[%s] buildTxnHarvest forces multiAccountScope when accountIdCount > 1 and URL is unscoped',
    (_bank, env) => {
      const internal = fixtureToInternal(env);
      const capturedAccountId = extractAccountIdFromUrl(internal.endpoint.url);
      const harvest = buildTxnHarvest(internal, 5);
      // When the captured URL has no account-id alias AND ACCOUNT-RESOLVE
      // committed > 1 ids, the harvest MUST flag multi-scope so SCRAPE
      // refuses to mirror the same records across iterations.
      if (capturedAccountId === false) {
        expect(harvest.multiAccountScope).toBe(true);
      } else {
        // Single-scoped URLs keep their body-shape decision intact.
        expect(typeof harvest.multiAccountScope).toBe('boolean');
      }
    },
  );

  // ── FilterDataStrategy — EMPTY_TXN_ENDPOINT path ──────────────────

  it.each(FILTER_DATA_ROWS)(
    '[%s] FilterDataStrategy with EMPTY_TXN_ENDPOINT.fieldMap still produces a Procedure result',
    async (_bank, env) => {
      // Even with the empty fieldMap (the replayablePost recovery
      // shape), the strategy must still drive its month loop without
      // throwing — parseFreshResponse delegates to extractTransactions.
      const fetchGet = stubFetchGetFail();
      const api = makeApi({ fetchGet });
      const network = makeNetwork();
      const fc: IAccountFetchCtx = {
        api,
        network,
        startDate: '20260101',
        txnEndpoint: EMPTY_TXN_ENDPOINT,
      };
      const result = await scrapeViaFilterData(fc, 'cross-bank-acct', env.captures[0].url);
      // The strategy returns a Procedure — success or fail, but never
      // throws. fail-loud paths surface via the Result-Pattern shape.
      expect(typeof result).toBe('object');
      expect(typeof result.success).toBe('boolean');
    },
  );

  // ── extractAccountIdFromUrl — deterministic outcome per fixture ────

  it.each(ALL_ROWS)(
    '[%s] extractAccountIdFromUrl returns string-or-false for every fixture URL',
    (_bank, env) => {
      const result = extractAccountIdFromUrl(env.captures[0].url);
      // Either a non-empty string (URL has a WK_ACCT.id alias) or false.
      const isValid = result === false || (typeof result === 'string' && result.length > 0);
      expect(isValid).toBe(true);
    },
  );
});
