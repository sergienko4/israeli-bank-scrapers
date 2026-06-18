/**
 * Leumi — contract extraction binding (Mode A/B value proof).
 *
 * <p>The Mode A static-drive and Mode B simulator tests prove the
 * committed Leumi fixtures match the DOM + manifest contract, but they
 * stop at the transport layer. This suite closes the loop: it drives the
 * SAME committed `UC_SO_27_GetBusinessAccountTrx` response fixture
 * through the REAL extraction code so the two production fixes are proven
 * end-to-end against the on-disk fixture, not a hand-built object.
 *
 * <ul>
 *   <li><b>Transactions (SCRAPE)</b> — `extractTransactions` unwraps the
 *   WCF `{ ProcessRequestResult, jsonResp }` envelope and maps every
 *   `HistoryTransactionsItems` row (Slice 1). Both rows are collected:
 *   "collect-all" within the account's single fetch window.</li>
 *   <li><b>Balance (BALANCE-RESOLVE)</b> — `runBalanceExtractor` reads
 *   the folded `BalanceDisplay` from the unwrapped body, and
 *   `buildCapturedFromPool` seeds it under {@link BULK_KEY} — the exact
 *   value/path the BALANCE-RESOLVE phase consumes (Slice 2).</li>
 * </ul>
 *
 * <p><b>N×M matrix degeneration.</b> Leumi's checking endpoint is a
 * single `OperationsNumber:40` call (empty FromDate/ToDate — no monthly
 * MatrixLoop). For one resolved account the N accounts × M date-windows
 * matrix degenerates to 1×1: one account, one window, all rows collected
 * in that window. The monthly-chunk loop (`MatrixLoopStrategy`) only
 * activates for card banks whose endpoint is a monthly template.
 *
 * <p>Fixture values are synthetic + PII-safe (zero monetary amounts,
 * redacted descriptions, short non-ID reference numbers).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { runBalanceExtractor } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import { BULK_KEY } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceFetchPlanner.js';
import { buildCapturedFromPool } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.Captured.js';
import { unwrapWcfEnvelope } from '../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponseEnvelope.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ContainerPicker/ContainerPicker.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = dirname(HERE_URL);
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const FIXTURE = join(
  REPO_ROOT,
  'src',
  'Tests',
  'Integration',
  'fixtures',
  'banks',
  'leumi',
  'responses',
  'business-account-trx.json',
);

/** Both synthetic history rows are expected to survive extraction. */
const EXPECTED_TXN_COUNT = 2;
/** Folded `BalanceDisplay` in the fixture (synthetic zero). */
const EXPECTED_BALANCE = 0;
/** Synthetic reference numbers (short — not Israeli-ID shaped). */
const REF_FIRST = 1000001;
const REF_SECOND = 1000002;

/**
 * Load the committed UC_SO_27 WCF envelope fixture.
 * @returns Parsed envelope `{ ProcessRequestResult, jsonResp }`.
 */
function loadEnvelope(): ApiRecord {
  const raw = readFileSync(FIXTURE, 'utf8');
  return JSON.parse(raw) as ApiRecord;
}

/**
 * Unwrap the WCF envelope to the inner balance/txn body — the shape the
 * captured network pool holds at BALANCE-RESOLVE time.
 * @param env - WCF envelope.
 * @returns Inner JSON payload.
 */
function innerBody(env: ApiRecord): JsonValue {
  return unwrapWcfEnvelope(env);
}

/**
 * Build a one-entry captured endpoint pool holding the given body.
 * @param body - Inner response body.
 * @returns Captured endpoint pool.
 */
function poolOf(body: unknown): readonly IDiscoveredEndpoint[] {
  const ep = { responseBody: body } as unknown as IDiscoveredEndpoint;
  return [ep];
}

describe('Leumi contract extraction — Slice 1 + Slice 2 on the committed fixture', () => {
  it('extracts every UC_SO_27 history txn (collect-all in the single window)', () => {
    const env = loadEnvelope();
    const txns = extractTransactions(env);
    expect(txns).toHaveLength(EXPECTED_TXN_COUNT);
    const ids = txns.map((t): unknown => t.identifier);
    expect(ids).toContain(REF_FIRST);
    expect(ids).toContain(REF_SECOND);
  });

  it('resolves the folded BalanceDisplay (the value BALANCE-RESOLVE reads)', () => {
    const env = loadEnvelope();
    const inner = innerBody(env);
    const balance = runBalanceExtractor(inner);
    expect(balance).toBe(EXPECTED_BALANCE);
  });

  it('seeds the captured-pool balance under BULK_KEY (Slice 2 mechanism)', () => {
    const env = loadEnvelope();
    const inner = innerBody(env);
    const pool = poolOf(inner);
    const captured = buildCapturedFromPool(pool);
    const bulk = captured.get(BULK_KEY);
    if (bulk === undefined) throw new ScraperError('captured pool must seed the balance body');
    const balance = runBalanceExtractor(bulk);
    expect(balance).toBe(EXPECTED_BALANCE);
  });
});
